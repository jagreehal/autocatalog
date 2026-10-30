import fs from 'node:fs';
import path from 'node:path';
import type { ValidationResult } from '@eventcatalog/visualiser/model';
import { parseFrontmatter } from 'autocatalog-core';
import {
  designFromModel,
  designModel,
  designReview,
  DESIGNS_DIR,
  fileIds,
  runtimeByEvent,
  designSchema,
  resolveDesign,
  type Design,
  type DesignInput,
  type StudioModel,
} from 'autocatalog-docs-core';
import { Document, isMap, isSeq } from 'yaml';
import { z } from 'zod';
import type { DocsCatalog } from './catalog';
import { markDesignsChanged, markSaved } from './dev-signals';
import { canvasModel, type DesignCheck } from './ui/lib/canvas-model';

/** What the editor reads of the catalog: its graph, and its events with the snapshots read. */
type CatalogView = Pick<DocsCatalog, 'graph' | 'events' | 'snapshots'>;

/** A design as its file says it, beside the design the site resolved from it. */
export interface EditableDesign {
  design: Design;
  authored: DesignInput;
  /** The Markdown under the frontmatter, written back exactly as it was. */
  body: string;
  /** The file on disk. */
  file: string;
  /** The keys each resource has in the file, in order: a save keeps them so. */
  order: string[][];
}

// The resources as the file lists them, keys in the order written.
const written = z.object({ resources: z.array(z.looseObject({})).default([]) });

/** The design at `repository`/`id`, read from its file as it is now; undefined when there is none. */
export function editableDesign(
  catalog: Pick<DocsCatalog, 'designs' | 'repositoryRoots'>,
  repository: string,
  id: string,
): EditableDesign | undefined {
  const design = catalog.designs.find(
    (candidate) => candidate.repository === repository && candidate.id === id,
  );

  const root = catalog.repositoryRoots[repository];

  if (!design || !root) return undefined;

  // The site read the design from this file; it is not a path anyone sends.
  const file = path.join(root, design.file);
  const { data, content } = parseFrontmatter(fs.readFileSync(file, 'utf8'));

  const order = written.safeParse(data).data?.resources.map((entry) => Object.keys(entry)) ?? [];

  return { design, authored: designSchema.parse(data), body: content, file, order };
}

/**
 * Check a canvas against the catalog as the design it would write, and write
 * it when `savedBy` names the editor tab saving and it holds. Nothing is
 * written that the site would then refuse to read. `checked` is what Studio's
 * own checks said of the same canvas.
 */
export function checkDesign(
  catalog: CatalogView,
  editable: EditableDesign,
  model: StudioModel,
  checked: ValidationResult,
  savedBy?: string,
): DesignCheck {
  // Studio names a resource by its id; one the canvas made has an id like `service-1a2b3c4d`.
  const named = (message: string) =>
    model.resources.reduce(
      (text, { id, name }) => text.replaceAll(`"${id}"`, `"${name}"`),
      message,
    );

  const studio = { errors: checked.errors.map(named), warnings: checked.warnings.map(named) };

  // Checked by the schema, written as built: the schema returns keys in its own order.
  const draft = designFromModel(model, editable.authored, editable.design, editable.order);
  const input = designSchema.safeParse(draft);

  if (!input.success) {
    return {
      ok: false,
      errors: input.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      warnings: studio.warnings,
    };
  }

  let design: Design;

  try {
    design = resolveDesign(input.data, catalog.graph, {
      repository: editable.design.repository,
      id: editable.design.id,
      file: editable.design.file,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: studio.warnings,
    };
  }

  if (studio.errors.length > 0) {
    return { ok: false, errors: studio.errors, warnings: studio.warnings };
  }

  if (savedBy !== undefined) {
    const text = `---\n${designYaml(draft)}---\n${editable.body}`;

    fs.writeFileSync(editable.file, text);
    markSaved(editable.file, text, savedBy);
    markDesignsChanged();
  }

  const review = designReview(design, catalog.graph, runtimeOf(catalog));

  // The editor outlines what is new by the canvas's ids, which a resource it made keeps until reloaded.
  const canvasId = new Map(
    [...fileIds(model, editable.design)].map(([canvas, file]) => [file, canvas]),
  );

  return {
    ok: true,
    review: {
      ...review,
      added: review.added.map((part) => ({ ...part, id: canvasId.get(part.id) ?? part.id })),
    },
    warnings: studio.warnings,
    saved: savedBy !== undefined,
  };
}

/** What each repository's runtime snapshot saw, by event, as the maps read it. */
const runtimeOf = (catalog: CatalogView) => runtimeByEvent(catalog.events, catalog.snapshots);

/** The design as the canvas opens it, and its review as it stands. */
export function openDesign(catalog: CatalogView, editable: EditableDesign) {
  return {
    model: canvasModel.parse(designModel(editable.authored, editable.design)),
    review: designReview(editable.design, catalog.graph, runtimeOf(catalog)),
  };
}

const LISTS = ['resources', 'relations', 'notes', 'hotspots'] as const;

/**
 * A design's frontmatter as people write it: one line per resource, relation,
 * note, hotspot and position, so a change on the canvas is a one-line change
 * in review. Lists with nothing in them are left out, as the schema defaults them.
 */
export function designYaml(input: ReturnType<typeof designFromModel>): string {
  const data = Object.fromEntries(
    Object.entries(input).filter(([, value]) => !(Array.isArray(value) && value.length === 0)),
  );

  const document = new Document(data);

  for (const key of LISTS) {
    const list = document.get(key);

    if (isSeq(list)) for (const item of list.items) if (isMap(item)) item.flow = true;
  }

  const layout = document.get('layout');

  if (isMap(layout)) {
    for (const level of layout.items) {
      if (!isMap(level.value)) continue;

      for (const place of level.value.items) if (isMap(place.value)) place.value.flow = true;
    }
  }

  return String(document);
}

/**
 * Whether a request to change a design came from this site's own page: the
 * same origin, and JSON, which a form on another site cannot send without
 * the browser asking first. Otherwise any page open in the same browser could
 * write files through the dev server.
 */
export function fromThisSite(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');

  return (
    (origin === null || origin === url.origin) &&
    (request.headers.get('content-type')?.startsWith('application/json') ?? false)
  );
}

/** A title as a file name: `Refunds v2` is `refunds-v2`. */
const fileName = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Start a design in `repository`: an empty `designs/<id>.md`, its id from the
 * title and never one the repository already has. Nothing is written for a
 * repository the site does not read, or a title with nothing to name a file.
 */
export function startDesign(
  catalog: Pick<DocsCatalog, 'repositoryRoots'>,
  repository: string,
  title: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const root = catalog.repositoryRoots[repository];
  const base = fileName(title);

  if (!root)
    return { ok: false, error: `The site does not read a repository called ${repository}.` };

  if (!base) return { ok: false, error: 'Give the design a title with a letter or digit in it.' };

  const folder = path.join(root, DESIGNS_DIR);

  let id = base;

  for (let n = 2; fs.existsSync(path.join(folder, `${id}.md`)); n++) id = `${base}-${n}`;

  fs.mkdirSync(folder, { recursive: true });
  // `wx`: a file that appeared since the check above is left as it is.
  fs.writeFileSync(
    path.join(folder, `${id}.md`),
    `---\n${new Document({ title: title.trim(), status: 'draft' })}---\n`,
    { flag: 'wx' },
  );
  markDesignsChanged();

  return { ok: true, id };
}

/**
 * Why the design at `repository`/`id` is not in the catalog, when its file is
 * there: someone wrote it so it does not hold (a `ref` to nothing, a relation
 * to no resource). Undefined when there is no such file.
 */
export function unreadable(
  catalog: Pick<DocsCatalog, 'graph' | 'repositoryRoots'>,
  repository: string,
  id: string,
): string | undefined {
  const root = catalog.repositoryRoots[repository];

  if (!root || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return undefined;

  const file = path.join(root, DESIGNS_DIR, `${id}.md`);

  if (!fs.existsSync(file)) return undefined;

  const parsed = designSchema.safeParse(parseFrontmatter(fs.readFileSync(file, 'utf8')).data);

  if (!parsed.success) return z.prettifyError(parsed.error).replace(/\n+/g, '; ');

  try {
    resolveDesign(parsed.data, catalog.graph, { repository, id, file });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
}
