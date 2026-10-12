import fs from 'node:fs/promises';
import path from 'node:path';
import {
  enrichEvent,
  jsonValueSchema,
  loadCodeowners,
  pascalCase,
  publishCatalog,
  type AdapterEvent,
  type DiscoveryAdapter,
  type DiscoveryCandidate,
  type DiscoveryOutput,
  type ProvenanceValue,
} from 'autocatalog-core';
import { z } from 'zod';
import { isCompactItem, isExplicitEvent, toAdapterEvent } from './event-mapper';
import { importsZod, staticExports, type StaticExport } from './static-scan';

export interface ScanOptions {
  root: string; // repo to scan
  out: string; // events output directory
  /** Directory names never descended into. */
  exclude?: string[];
  /** When false, discover only — do not write folders (for multi-source merge). Default true. */
  write?: boolean;
}

export interface ScanFinding {
  file: string; // relative to root
  symbol: string;
  line?: number;
  kind: 'defineEvent' | 'registry' | 'convention';
  id: string;
  needsReview: boolean;
  source?: 'zod';
}

export interface ScanResult {
  eventsWritten: number;
  findings: ScanFinding[];
  errors: string[];
  /** Populated even when write:false — for multi-source merge. */
  events: AdapterEvent[];
}

/** Discovery output whose findings keep their Zod-specific type. */
export interface ZodDiscoveryOutput extends DiscoveryOutput {
  candidates: DiscoveryCandidate<ScanFinding>[];
  findings: ScanFinding[];
}

/**
 * defineEvent() meta as literally written in a scanned file. Only the fields
 * we read are checked; everything else passes through to the event's meta.
 */
// `version: 1` is a version; a number written where text belongs is read as text.
const text = z.union([z.string(), z.number().transform(String)]).optional();

const StaticMetaSchema = z.looseObject({
  id: text,
  version: text,
  name: text,
  summary: text,
  domain: text,
  example: jsonValueSchema.optional(),
});

type StaticMeta = z.infer<typeof StaticMetaSchema>;

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.git', 'coverage', 'events'];

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;

const TEST_FILE = /\.(test|spec|stories)\.[cm]?tsx?$/;

const CONVENTION_RE = /(Event|EventSchema)$/;

/** "ParcelShippedEvent" | "ParcelShippedEventSchema" → "parcel.shipped" */
export function idFromSymbol(symbol: string): string {
  const base = symbol.replace(/EventSchema$|Event$|Schema$/, '') || symbol;

  return base.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}

/** Domain guess: schema metadata wins, then the defining file's directory name. */
export function domainForFile(relFile: string, fallbackId: string): string {
  const dir = path.basename(path.dirname(relFile));

  if (dir && !['src', 'lib', 'source', '.', ''].includes(dir)) return dir;

  return fallbackId.split('.')[0]!;
}

async function walkSource(
  root: string,
  exclude: Set<string>,
  signal?: AbortSignal,
  maxFiles = 50_000,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    signal?.throwIfAborted();
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!exclude.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
        results.push(full);

        if (results.length > maxFiles) throw new Error(`source file limit exceeded (${maxFiles})`);
      }
    }
  }

  await walk(root);

  return results;
}

function eventFromStatic(input: {
  ex: StaticExport;
  meta: StaticMeta | undefined;
  relFile: string;
  isRegistryMember: boolean;
}): { event: AdapterEvent; finding: ScanFinding } | null {
  const { ex, meta, relFile, isRegistryMember } = input;

  if (!ex.schema) return null;

  const limits = ex.schema.limits;

  const derivedId = idFromSymbol(ex.symbol);
  const id = meta?.id ?? derivedId;
  const version = meta?.version ?? '0.1.0';
  const domain = meta?.domain ?? domainForFile(relFile, id);

  const kind: ScanFinding['kind'] = meta
    ? 'defineEvent'
    : isRegistryMember
      ? 'registry'
      : 'convention';

  const inferredFields: Record<string, ProvenanceValue> = {};

  if (!meta?.id) inferredFields.id = 'inferred';

  if (!meta?.version) inferredFields.version = 'inferred';

  if (!meta?.domain) inferredFields.domain = 'inferred';

  if (!meta?.summary) inferredFields.summary = 'inferred';

  // A schema we could not fully represent is never silently published as fact.
  const incomplete = limits.length > 0;
  const needsReview = incomplete || !meta?.id || !meta?.version;
  const confidence = meta?.id && meta.version ? 0.95 : isRegistryMember ? 0.9 : meta ? 0.7 : 0.4;

  const summary =
    meta?.summary ??
    (incomplete
      ? `Partially extracted from \`${ex.symbol}\` in ${relFile}: ${limits.map((l) => l.reason).join('; ')}.`
      : `Extracted from export \`${ex.symbol}\` in ${relFile}.`);

  const event: AdapterEvent = {
    id,
    version,
    name: meta?.name ?? pascalCase(id).replace(/([a-z])([A-Z])/g, '$1 $2'),
    summary,
    domain,
    folderName: pascalCase(id),
    schema: ex.schema.schema,
    examples: meta?.example !== undefined ? [{ name: 'default', data: meta.example }] : [],
    meta,
    source: { type: 'code', file: relFile, symbol: ex.symbol, line: ex.line },
    provenance: {
      default: meta || isRegistryMember ? 'extracted' : 'inferred',
      fields: inferredFields,
    },
    confidence,
    needsReview,
  };

  return {
    event,
    finding: {
      file: relFile,
      symbol: ex.symbol,
      line: ex.line,
      kind,
      id,
      needsReview,
      source: 'zod',
    },
  };
}

/**
 * Discover Zod event definitions by reading source. Never executes anything.
 * - defineEvent()-wrapped exports          -> extracted
 * - members of a z.discriminatedUnion      -> extracted
 * - arrays of hand-written event records   -> extracted
 * - bare exports named *Event/*EventSchema -> inferred, needs review
 * Anything we could not represent in JSON Schema is flagged, never dropped silently.
 */
export async function discoverZodEvents(opts: {
  root: string;
  exclude?: string[];
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}): Promise<ZodDiscoveryOutput> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])]);
  const files = await walkSource(root, exclude, opts.signal, opts.maxFiles);

  const errors: string[] = [];
  const candidates: ZodDiscoveryOutput['candidates'] = [];

  for (const file of files) {
    opts.signal?.throwIfAborted();
    const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

    if ((await fs.stat(file)).size > maxFileBytes) {
      errors.push(`${path.relative(root, file)}: file exceeds ${maxFileBytes} bytes`);
      continue;
    }

    const text = await fs.readFile(file, 'utf8');

    if (!importsZod(text) && !text.includes('defineEvent(')) continue;
    // Forward slashes on every platform: the path is recorded in the event's source.
    const relFile = path.relative(root, file).split(path.sep).join('/');

    let exports: StaticExport[];

    try {
      exports = staticExports(text, file);
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // Members of a discriminatedUnion are events by construction — but only when the
    // union itself is named as one. ag-ui's MessageSchema is a union of messages, not
    // events; treating every union as an event registry doubled its catalog with noise.
    const registryMembers = new Set<string>();

    for (const ex of exports) {
      if (!CONVENTION_RE.test(ex.symbol)) continue;

      for (const member of ex.unionMembers ?? []) registryMembers.add(member);
    }

    for (const ex of exports) {
      for (const { item, limits } of ex.registryItems ?? []) {
        // An array of anything else is not an event registry.
        if (!isExplicitEvent(item) && !isCompactItem(item)) continue;

        let event: AdapterEvent;

        try {
          event = toAdapterEvent(item);
        } catch (err) {
          errors.push(
            `${relFile}: ${ex.symbol}: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }

        // A schema we could not fully represent is never published as fact.
        const needsReview = limits.length > 0;
        event.source = { type: 'code', file: relFile, symbol: ex.symbol, line: ex.line };
        event.needsReview = needsReview;
        candidates.push({
          event,
          finding: {
            file: relFile,
            symbol: ex.symbol,
            line: ex.line,
            kind: 'registry',
            id: event.id,
            needsReview,
            source: 'zod',
          },
        });
      }

      if (ex.registryItems) continue;

      if (ex.unionMembers) continue; // the union itself is a registry, not an event
      const isRegistryMember = registryMembers.has(ex.symbol);

      if (!ex.defineEventMeta && !CONVENTION_RE.test(ex.symbol) && !isRegistryMember) continue;
      const parsedMeta = ex.defineEventMeta && StaticMetaSchema.safeParse(ex.defineEventMeta);

      if (parsedMeta && !parsedMeta.success) {
        errors.push(
          `${relFile}: defineEvent meta for ${ex.symbol}: ${z.prettifyError(parsedMeta.error)}`,
        );
        continue;
      }

      const built = eventFromStatic({ ex, meta: parsedMeta?.data, relFile, isRegistryMember });

      if (built) {
        candidates.push(built);
      }
    }
  }

  return {
    candidates,
    events: candidates.map((candidate) => candidate.event),
    findings: candidates.map((candidate) => candidate.finding),
    errors,
  };
}

export const zodDiscoveryAdapter: DiscoveryAdapter = {
  name: 'zod',
  discover: ({ root, exclude, signal, limits }) =>
    discoverZodEvents({
      root,
      exclude,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};

/**
 * Repo-wide Zod discovery. By default enriches and writes event folders.
 * Pass `write: false` when a multi-source scanner will merge and write.
 */
export async function scanRepo(opts: ScanOptions): Promise<ScanResult> {
  const discovered = await discoverZodEvents({ root: opts.root, exclude: opts.exclude });
  const shouldWrite = opts.write !== false;
  const codeowners = shouldWrite ? await loadCodeowners(path.resolve(opts.root)) : [];

  let written = 0;
  const errors = [...discovered.errors];

  if (shouldWrite) {
    const events = discovered.candidates.map((candidate) => candidate.event);

    try {
      for (const event of events) enrichEvent(event, codeowners);

      if (errors.length === 0) {
        written = (await publishCatalog({ outRoot: path.resolve(opts.out), events })).eventsWritten;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    eventsWritten: written,
    findings: discovered.candidates.map((candidate) => candidate.finding),
    errors,
    events: discovered.candidates.map((candidate) => candidate.event),
  };
}
