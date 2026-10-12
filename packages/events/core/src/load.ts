import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { parseFrontmatter } from './frontmatter';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from './json';
import { AUTOCATALOG_EVENT_FILE, eventFrontmatter, type EventFrontmatter } from './schema';
import type { DiscoveredEventFolder } from './discover';
import { discoverEventFolders } from './discover';
import { verifyCatalogArtifact } from './catalog-artifact';
import { waitForCatalogPublication } from './catalog-lock';

/**
 * The edge cases an example can show, each a folder under `examples/`. A file
 * directly in `examples/` is the happy path. EventCatalog renders nested
 * example folders as they are, so the convention costs it nothing.
 */
export const EXAMPLE_CASES = ['empty', 'partial', 'duplicate', 'late', 'invalid'] as const;

export type ExampleCase = (typeof EXAMPLE_CASES)[number];

/** What each case shows a consumer, said the same way wherever it is published. */
export const EXAMPLE_CASE_MEANING: Record<ExampleCase, string> = {
  empty: 'Nothing to report, still a valid message',
  partial: 'Only the fields that are always there',
  duplicate: 'A repeat consumers must recognise',
  late: 'Arrives after events that happened after it',
  invalid: 'A message consumers must reject',
};

/** "Duplicate: a repeat consumers must recognise", for a summary that stands alone. */
export function exampleCaseSummary(exampleCase: ExampleCase): string {
  const meaning = EXAMPLE_CASE_MEANING[exampleCase];

  return `${exampleCase[0]!.toUpperCase()}${exampleCase.slice(1)}: ${meaning[0]!.toLowerCase()}${meaning.slice(1)}`;
}

export interface LoadedExample {
  name: string; // file basename without extension
  path: string; // absolute path
  data: JsonValue;
  /** The edge case it shows, from its folder; absent for the happy path. */
  case?: ExampleCase;
  /** From `examples.config.yaml`, EventCatalog's per-example metadata. */
  title?: string;
  summary?: string;
}

const exampleCase = z.enum(EXAMPLE_CASES).optional().catch(undefined);

/** A JSON file under examples/ that is a payload, not EventCatalog's examples.config.json. */
export function isExamplePayload(relative: string): boolean {
  return relative.endsWith('.json') && path.basename(relative) !== 'examples.config.json';
}

/**
 * The case of an example at this path under `examples/`, from its first folder.
 * Only a folder: an example simply named `empty` is a name, not a case.
 */
export function exampleCaseOf(relative: string): ExampleCase | undefined {
  const [first, ...rest] = relative.split(/[\\/]/);

  return rest.length > 0 ? exampleCase.parse(first) : undefined;
}

export interface LoadedEvent {
  folder: DiscoveredEventFolder;
  frontmatter: EventFrontmatter & { domain: string };
  body: string;
  schemaPath: string;
  schema: JsonObject;
  examples: LoadedExample[];
}

export type CatalogDiagnosticCode =
  | 'events_directory_missing'
  | 'event_load_failed'
  | 'artifact_invalid'
  | 'artifact_integrity_mismatch';

export interface CatalogDiagnostic {
  code: CatalogDiagnosticCode;
  severity: 'error';
  message: string;
  path: string;
}

export interface CatalogSnapshot {
  root: string;
  events: LoadedEvent[];
  diagnostics: CatalogDiagnostic[];
  valid: boolean;
}

export interface LoadCatalogOptions {
  skipVersioned?: boolean;
  /** Collect diagnostics instead of throwing when any event cannot be loaded. */
  mode?: 'strict' | 'collect';
}

export class CatalogLoadError extends Error {
  constructor(public readonly snapshot: CatalogSnapshot) {
    const details = snapshot.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    super(`Catalog at ${snapshot.root} is invalid: ${details}`);
    this.name = 'CatalogLoadError';
  }
}

async function readJson(p: string): Promise<JsonValue> {
  const raw = await fs.readFile(p, 'utf8');

  return jsonValueSchema.parse(JSON.parse(raw));
}

async function listExampleFiles(eventFolder: string): Promise<string[]> {
  const dir = path.join(eventFolder, 'examples');

  try {
    const entries = await fs.readdir(dir, { recursive: true });

    return entries
      .filter(isExamplePayload)
      .map((name) => path.join(dir, name))
      .sort();
  } catch {
    return [];
  }
}

// EventCatalog's per-example metadata, keyed by path under examples/. A file
// that cannot be read or parsed is metadata nobody wrote, not a broken event.
const exampleConfig = z
  .record(
    z.string(),
    z.object({ name: z.string().optional(), summary: z.string().optional() }).catch({}),
  )
  .catch({});

async function readExampleConfig(eventFolder: string) {
  for (const file of ['examples.config.yaml', 'examples.config.yml', 'examples.config.json']) {
    try {
      const raw = await fs.readFile(path.join(eventFolder, 'examples', file), 'utf8');

      return exampleConfig.parse(parseYaml(raw));
    } catch {
      // try the next name
    }
  }

  return {};
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);

    return true;
  } catch {
    return false;
  }
}

async function resolveContainedFile(
  folderRoot: string,
  candidate: string,
  label: string,
): Promise<string> {
  if (path.isAbsolute(candidate)) throw new Error(`${label} must be relative: ${candidate}`);
  const root = await fs.realpath(folderRoot);
  const lexical = path.resolve(root, candidate);

  if (lexical === root || !lexical.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the Event folder: ${candidate}`);
  }

  const resolved = await fs.realpath(lexical);

  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} resolves outside the Event folder: ${candidate}`);
  }

  return resolved;
}

export async function loadEventFolder(folder: DiscoveredEventFolder): Promise<LoadedEvent> {
  const manifestCandidate = path.join(folder.path, AUTOCATALOG_EVENT_FILE);
  const mdxCandidate = path.join(folder.path, 'index.mdx');
  let frontmatter: EventFrontmatter;
  let body = '';

  if (!(await fileExists(manifestCandidate))) {
    throw new Error(
      `Missing ${AUTOCATALOG_EVENT_FILE} in ${folder.path} — the manifest is the canonical event contract; index.mdx frontmatter is not read`,
    );
  }

  const manifestPath = await resolveContainedFile(
    folder.path,
    AUTOCATALOG_EVENT_FILE,
    'Event manifest',
  );

  try {
    frontmatter = eventFrontmatter.parse(await readJson(manifestPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid event metadata in ${folder.path}: ${message}`, { cause: err });
  }

  if (await fileExists(mdxCandidate)) {
    const mdxPath = await resolveContainedFile(folder.path, 'index.mdx', 'Narrative');
    const raw = await fs.readFile(mdxPath, 'utf8');
    body = parseFrontmatter(raw).content;
  }

  const domain = frontmatter.domain ?? folder.defaultDomain;
  const schemaPath = await resolveContainedFile(folder.path, frontmatter.schema, 'Schema path');

  let schema: JsonObject;

  try {
    const parsed = jsonObjectSchema.safeParse(await readJson(schemaPath));

    if (!parsed.success) throw new Error('a JSON Schema document must be an object');
    schema = parsed.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read schema for ${manifestPath} at ${schemaPath}: ${message}`, {
      cause: err,
    });
  }

  const explicitExamples = frontmatter.examples;

  const exampleCandidates =
    explicitExamples.length > 0 ? explicitExamples : await listExampleFiles(folder.path);

  const examples: LoadedExample[] = [];
  const config = await readExampleConfig(folder.path);

  for (const candidate of exampleCandidates) {
    const relative = path.isAbsolute(candidate) ? path.relative(folder.path, candidate) : candidate;
    const p = await resolveContainedFile(folder.path, relative, 'Example path');

    // From the path as written: the resolved one may sit under a symlinked root.
    const underExamples = path
      .relative('examples', path.normalize(relative))
      .split(path.sep)
      .join('/');

    const exampleCase = exampleCaseOf(underExamples);
    const meta = config[underExamples];

    examples.push({
      name: path.basename(p, path.extname(p)),
      path: p,
      data: await readJson(p),
      ...(exampleCase && { case: exampleCase }),
      ...(meta?.name && { title: meta.name }),
      ...(meta?.summary && { summary: meta.summary }),
    });
  }

  return {
    folder,
    frontmatter: { ...frontmatter, domain },
    body,
    schemaPath,
    schema,
    examples,
  };
}

export async function loadCatalogSnapshot(
  eventsRoot: string,
  opts: LoadCatalogOptions = {},
): Promise<CatalogSnapshot> {
  const root = path.resolve(eventsRoot);
  await waitForCatalogPublication(root);
  const folders = await discoverEventFolders(eventsRoot);
  const events: LoadedEvent[] = [];
  const diagnostics: CatalogDiagnostic[] = [];
  const skipped = new Set<string>();

  try {
    await fs.access(root);
  } catch {
    diagnostics.push({
      code: 'events_directory_missing',
      severity: 'error',
      message: `Events directory does not exist: ${root}`,
      path: root,
    });
  }

  for (const folder of folders) {
    if (opts?.skipVersioned && folder.isVersioned) {
      skipped.add(path.relative(root, folder.path).split(path.sep).join('/'));
      continue;
    }

    try {
      events.push(await loadEventFolder(folder));
    } catch (error) {
      diagnostics.push({
        code: 'event_load_failed',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        path: folder.path,
      });
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.code === 'event_load_failed')) {
    diagnostics.push(
      ...(await verifyCatalogArtifact(root, events, skipped)).map((diagnostic) => ({
        ...diagnostic,
        severity: 'error' as const,
      })),
    );
  }

  const snapshot = { root, events, diagnostics, valid: diagnostics.length === 0 };

  if (!snapshot.valid && opts.mode !== 'collect') throw new CatalogLoadError(snapshot);

  return snapshot;
}

/** Load a complete Catalog. Invalid events fail the whole read instead of disappearing. */
export async function loadCatalog(
  eventsRoot: string,
  opts: Omit<LoadCatalogOptions, 'mode'> = {},
): Promise<LoadedEvent[]> {
  return (await loadCatalogSnapshot(eventsRoot, { ...opts, mode: 'strict' })).events;
}
