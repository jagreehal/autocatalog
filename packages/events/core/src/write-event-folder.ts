import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AUTOCATALOG_EVENT_FILE, eventFrontmatter, type EventFrontmatter } from './schema';
import type { AdapterEvent } from './adapter-event';

export interface WriteEventFolderOptions {
  outRoot: string;
  event: AdapterEvent;
  /** Internal publication placement; every segment is validated for portability. */
  folderSegments?: string[];
}

function safeSegment(value: string, label: string): string {
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    /[<>:"|?*]/.test(value) ||
    [...value].some((char) => char < ' ') || // ASCII control characters
    value.endsWith('.') ||
    value.endsWith(' ') ||
    windowsReserved.test(value)
  ) {
    throw new Error(`Unsafe ${label} path segment: ${JSON.stringify(value)}`);
  }

  return value;
}

export function adapterEventToFrontmatter(
  event: AdapterEvent,
): Omit<EventFrontmatter, 'needsReview'> & Partial<Pick<EventFrontmatter, 'needsReview'>> {
  const parsed = eventFrontmatter.safeParse({
    spec: 'autocatalog/v2' as const,
    id: event.id,
    version: event.version,
    name: event.name,
    summary: event.summary,
    domain: event.domain,
    status: event.meta?.status ?? ('active' as const),
    classification: event.meta?.classification,
    producers: event.meta?.producers ?? [],
    consumers: event.meta?.consumers ?? [],
    consumerFields: event.meta?.consumerFields,
    tags: event.meta?.tags ?? [],
    badges: event.meta?.badges ?? [],
    schema: './schema.json',
    examples: [],
    owner: event.meta?.owner ?? (event.meta?.team ? { team: event.meta.team } : undefined),
    deprecation: event.meta?.deprecation,
    source: event.source,
    transport: event.meta?.transport,
    delivery: event.meta?.delivery,
    envelope: event.meta?.envelope,
    provenance: event.provenance
      ? { default: event.provenance.default, fields: event.provenance.fields ?? {} }
      : undefined,
    observed: event.observed,
    confidence: event.confidence,
    needsReview: event.needsReview || undefined,
  });

  if (!parsed.success) {
    throw new Error(`${event.id}: invalid event metadata\n${z.prettifyError(parsed.error)}`);
  }

  const manifest = parsed.data;

  // Keep generated manifests terse; the schema default remains false when loaded.
  const { needsReview, ...terse } = manifest;

  return needsReview ? manifest : terse;
}

/** Write (or overwrite) an event folder: autocatalog.json + schema.json + examples/. */
export async function writeEventFolder(opts: WriteEventFolderOptions): Promise<void> {
  const { outRoot, event } = opts;
  const segments = opts.folderSegments ?? [event.domain, event.folderName];

  const folder = path.join(
    outRoot,
    ...segments.map((segment, index) =>
      safeSegment(
        segment,
        opts.folderSegments
          ? `folder segment ${index + 1}`
          : index === 0
            ? 'domain'
            : 'folder name',
      ),
    ),
  );

  const examplesDir = path.join(folder, 'examples');

  await fs.mkdir(examplesDir, { recursive: true });

  const frontmatter = adapterEventToFrontmatter(event);

  await fs.writeFile(
    path.join(folder, AUTOCATALOG_EVENT_FILE),
    JSON.stringify(frontmatter, null, 2) + '\n',
  );

  // index.mdx is optional human-authored narrative — never created or touched here

  await fs.writeFile(
    path.join(folder, 'schema.json'),
    JSON.stringify(event.schema, null, 2) + '\n',
  );

  // Only happy-path files are this writer's to remove: a case folder may hold
  // examples a person wrote, which a rescan must not delete.
  const desiredNames = new Set(event.examples.filter((e) => !e.case).map((e) => `${e.name}.json`));
  const portableNames = new Set<string>();

  // Two examples collide when they would land on the same file, here or on a
  // case-insensitive file system; the same name in two case folders does not.
  for (const example of event.examples) {
    const destination = [example.case, example.name].filter(Boolean).join('/');
    const portable = destination.normalize('NFC').toLocaleLowerCase('en-US');

    if (portableNames.has(portable)) {
      throw new Error(`Duplicate or case-colliding example name: ${destination}`);
    }

    portableNames.add(portable);
  }

  const existing = await fs.readdir(examplesDir).catch(() => []);

  for (const name of existing) {
    if (name.endsWith('.json') && !desiredNames.has(name)) {
      await fs.unlink(path.join(examplesDir, name));
    }
  }

  for (const ex of event.examples) {
    safeSegment(ex.name, 'example name');
    const dir = ex.case ? path.join(examplesDir, ex.case) : examplesDir;

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${ex.name}.json`), JSON.stringify(ex.data, null, 2) + '\n');
  }
}
