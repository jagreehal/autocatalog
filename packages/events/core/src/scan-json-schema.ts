import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseAdapterEventMeta, readVendorMeta } from './adapter-event';
import type { AdapterEvent, AdapterEventMeta, ProvenanceValue } from './adapter-event';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import type {
  DiscoveryOutput,
  DiscoveryAdapter,
  DiscoveryCandidate,
  ScanFindingBase,
} from './merge-discoveries';
import { DEFAULT_SCAN_EXCLUDE, pascalCase } from './utils';
import { readOptionalResourceJson } from './resource-files';

export interface ScanJsonSchemaOptions {
  root: string;
  /** Directory names never descended into. Always includes node_modules, events, etc. */
  exclude?: string[];
  /** Absolute or relative path of the events output dir — skipped when under root. */
  outDir?: string;
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}

const SKIP_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.json',
  'tsconfig.json',
  'jsconfig.json',
  'turbo.json',
  'lerna.json',
  'nx.json',
  'project.json',
  'autocatalog.json',
  // The project's own contracts: JSON Schemas for event manifests and document
  // frontmatter, committed under contracts/ beside the event contracts.
  'event-manifest.json',
  'docs-frontmatter.json',
  '.eslintrc.json',
  'components.json',
]);

const SKIP_BASENAME_RE =
  /^(tsconfig|jsconfig|eslint|prettier|babel|jest|vitest|playwright).*\.json$/i;

export interface JsonSchemaScanFinding extends ScanFindingBase {
  kind: 'json-schema' | 'json-schema-sidecar';
  source: 'json-schema';
}

function titleCase(pascal: string): string {
  return pascal.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** "payment.completed" or "https://example.com/schemas/payment.completed.json" → id */
export function idFromSchemaId(schemaId: string): string | undefined {
  try {
    const url = new URL(schemaId);
    const base = path.basename(url.pathname).replace(/\.schema\.json$|\.json$/i, '');

    // An empty derivation must fall through to the filename, not be returned as
    // an id: `?? ` keeps an empty string, and only `undefined` falls back.
    if (base && base !== '/')
      return (base.includes('.') ? base : idFromFilename(base)) || undefined;
  } catch {
    // not a URL
  }

  const cleaned = schemaId.replace(/^#\/?/, '').trim();

  if (!cleaned) return undefined;

  if (cleaned.includes('.')) return cleaned.replace(/\.schema\.json$|\.json$/i, '');

  return idFromFilename(cleaned);
}

/** PaymentCompleted / payment-completed / payment_completed → payment.completed */
export function idFromFilename(name: string): string {
  const base = name.replace(/(\.schema)?\.json$/i, '').replace(/\.schema$/i, '');

  if (base.includes('.')) return base.toLowerCase();

  if (base.includes('-') || base.includes('_')) {
    return base.replace(/[-_]+/g, '.').toLowerCase();
  }

  const split = base.replace(/([a-z0-9])([A-Z])/g, '$1.$2');
  // Stripping a trailing "Schema" must never consume the whole name: a file or
  // `$id` that is literally `schema` would otherwise produce an empty id, and an
  // event with no id fails the discovery contract and takes the scan with it.
  const trimmed = split.replace(/Schema$/i, '');

  return (trimmed || split).toLowerCase();
}

/**
 * Directory names that describe how a repository is filed, not what a team
 * owns. A domain called "contracts" is the directory answering, not the domain.
 */
const GENERIC_PATH_SEGMENTS = new Set([
  'src',
  'lib',
  'source',
  'schemas',
  'schema',
  'json',
  'events',
  'contracts',
  'spec',
  'specs',
  'api',
  'apis',
  'docs',
  'dist',
  'build',
  'assets',
  'data',
  'types',
  'shared',
  'common',
  '.',
]);

/**
 * Guess a domain from where the file sits.
 *
 * Reports which answer it gave: a real directory segment is a reasonable guess,
 * the id prefix is a last resort. The caller uses that to decide whether a
 * human should confirm it, because "inferred" and "inferred with nothing to go
 * on" are not the same claim.
 */
export interface GuessedDomain {
  domain: string;
  from: 'path' | 'id';
}

export function domainForJsonPath(relFile: string, fallbackId: string): GuessedDomain {
  const parts = relFile.split(/[/\\]/).filter(Boolean);

  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i]!;

    if (!GENERIC_PATH_SEGMENTS.has(seg.toLowerCase())) return { domain: seg, from: 'path' };
  }

  return { domain: fallbackId.split('.')[0]!, from: 'id' };
}

/**
 * Heuristic: does this JSON object look like a JSON Schema (not package.json etc.)?
 */
const anything = z.unknown();

/** Any one of these marks a JSON Schema rather than package.json and friends. */
const jsonSchemaSignals = z.union([
  z.looseObject({ $schema: z.string() }),
  z
    .looseObject({ $id: z.string() })
    .refine((obj) => obj.type !== undefined || obj.properties !== undefined),
  z.looseObject({
    type: z.literal('object'),
    properties: z.union([z.looseObject({}), z.array(anything)]),
  }),
  z
    .looseObject({ type: z.union([z.string(), z.array(anything)]) })
    .refine((obj) => Boolean(obj.properties || obj.items)),
  z.looseObject({}).refine((obj) => Boolean(obj.$ref || obj.allOf || obj.anyOf || obj.oneOf)),
]);

/**
 * Heuristic: does this JSON object look like a JSON Schema (not package.json etc.)?
 */
export function looksLikeJsonSchema(value: JsonValue): value is JsonObject {
  return jsonSchemaSignals.safeParse(value).success;
}

function readAutocatalogExtension(schema: JsonObject): AdapterEventMeta | undefined {
  const vendor = readVendorMeta(schema);

  if (vendor) return vendor;
  const defs = schema.$defs;

  if (isJsonObject(defs) && isJsonObject(defs.autocatalog)) {
    return parseAdapterEventMeta(defs.autocatalog);
  }

  return undefined;
}

async function loadSidecarMeta(schemaPath: string): Promise<AdapterEventMeta | undefined> {
  const dir = path.dirname(schemaPath);
  const base = path.basename(schemaPath, path.extname(schemaPath));

  const candidates = [
    path.join(dir, `${base}.autocatalog.json`),
    path.join(dir, 'autocatalog.meta.json'),
  ];

  for (const candidate of candidates) {
    try {
      // A symlink could name any file on this machine; only the repository's own files are read.
      if (!(await fs.lstat(candidate)).isFile()) continue;
      const raw: JsonValue = JSON.parse(await fs.readFile(candidate, 'utf8'));

      if (isJsonObject(raw)) return parseAdapterEventMeta(raw);
    } catch {
      // missing or invalid
    }
  }

  return undefined;
}

async function walkJsonFiles(
  root: string,
  exclude: Set<string>,
  outAbs?: string,
  signal?: AbortSignal,
  maxFiles = 50_000,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    signal?.throwIfAborted();

    if (outAbs && (dir === outAbs || dir.startsWith(outAbs + path.sep))) return;
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      // Directories are walked and regular files read. A symlink is neither: it
      // could name any file on this machine, and the catalog gets published.
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        if (SKIP_BASENAMES.has(entry.name)) continue;

        if (SKIP_BASENAME_RE.test(entry.name)) continue;

        if (entry.name.endsWith('.autocatalog.json')) continue;
        results.push(full);

        if (results.length > maxFiles) throw new Error(`JSON file limit exceeded (${maxFiles})`);
      }
    }
  }

  await walk(root);

  return results;
}

const commandDeclaration = z.object({
  kind: z.string().optional(),
  schema: z.string().default('./schema.json'),
  outcome: z.object({ schema: z.string().optional() }).optional(),
});

/**
 * The payload and result schemas named by a command manifest in this
 * directory: command contracts, which command discovery owns. A manifest is a
 * command's when it says so, or sits in the `commands/` convention and says
 * nothing else.
 */
async function commandSchemas(directory: string, root: string): Promise<Set<string>> {
  const manifest = path.join(directory, 'autocatalog.json');
  const value = await readOptionalResourceJson(manifest, { root }).catch(() => undefined);
  const parsed = commandDeclaration.safeParse(value);
  const conventional = path.relative(root, directory).split(path.sep).includes('commands');

  if (!parsed.success || (parsed.data.kind ?? (conventional ? 'command' : '')) !== 'command')
    return new Set();

  return new Set(
    [parsed.data.schema, parsed.data.outcome?.schema].flatMap((file) =>
      file ? [path.resolve(directory, file)] : [],
    ),
  );
}

function eventFromJsonSchemaFile(input: {
  schema: JsonObject;
  meta: AdapterEventMeta | undefined;
  relFile: string;
  fromSidecar: boolean;
}): DiscoveryCandidate<JsonSchemaScanFinding> {
  const { schema, meta, relFile, fromSidecar } = input;
  const schemaId = z.string().safeParse(schema.$id);
  const fromId = schemaId.success ? idFromSchemaId(schemaId.data) : undefined;
  const fromFile = idFromFilename(path.basename(relFile));
  const id = meta?.id ?? fromId ?? fromFile;
  const version = meta?.version ?? '0.1.0';
  const guessedDomain = domainForJsonPath(relFile, id);
  const domain = meta?.domain ?? guessedDomain.domain;
  const folderName = pascalCase(id);

  const inferredFields: Record<string, ProvenanceValue> = {};

  if (!meta?.id) inferredFields.id = 'inferred';

  if (!meta?.version) inferredFields.version = 'inferred';

  if (!meta?.domain) inferredFields.domain = 'inferred';

  if (!meta?.summary) inferredFields.summary = 'inferred';

  const hasDeclaredMeta = Boolean(meta && (meta.id || meta.version || meta.producers));
  // needsReview stays about identity. A domain guessed from the id is weaker
  // evidence, not a missing fact, and flagging a well-formed event over an
  // optional field is the noise that gets a review gate switched off.
  const guessedDomainFromNothing = !meta?.domain && guessedDomain.from === 'id';
  const needsReview = !meta?.id || !meta?.version;
  const base = meta?.id && meta?.version ? 0.9 : hasDeclaredMeta ? 0.65 : 0.45;
  // Nothing in the path supported the domain, so it came from the id prefix.
  // The event is still well identified; one of its fields is a guess.
  const confidence = guessedDomainFromNothing ? Number((base - 0.15).toFixed(2)) : base;

  const title = z.string().catch(titleCase(folderName)).parse(schema.title);

  const description = z
    .string()
    .catch(`Extracted from JSON Schema at ${relFile} — review before trusting.`)
    .parse(schema.description);

  const event: AdapterEvent = {
    id,
    version,
    name: meta?.name ?? title,
    summary: meta?.summary ?? description,
    domain,
    folderName,
    schema,
    examples: meta?.example !== undefined ? [{ name: 'default', data: meta.example }] : [],
    meta,
    source: { type: 'code', file: relFile, symbol: path.basename(relFile) },
    provenance: {
      default: meta ? 'extracted' : 'inferred',
      fields: inferredFields,
    },
    confidence,
    needsReview,
  };

  const finding: JsonSchemaScanFinding = {
    file: relFile,
    symbol: path.basename(relFile),
    kind: fromSidecar ? 'json-schema-sidecar' : 'json-schema',
    id,
    needsReview,
    source: 'json-schema',
  };

  return { event, finding };
}

/**
 * Discover JSON Schema files in a repo and map them to AdapterEvents.
 * Does not write to disk — caller merges with other sources and writes once.
 */
export async function discoverJsonSchemas(opts: ScanJsonSchemaOptions): Promise<DiscoveryOutput> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_SCAN_EXCLUDE, ...(opts.exclude ?? [])]);
  const outAbs = opts.outDir ? path.resolve(opts.outDir) : undefined;
  const files = await walkJsonFiles(root, exclude, outAbs, opts.signal, opts.maxFiles);

  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  const commandsByDirectory = new Map<string, Promise<Set<string>>>();

  for (const file of files) {
    opts.signal?.throwIfAborted();
    const relFile = path.relative(root, file);

    const directory = path.dirname(file);

    if (!commandsByDirectory.has(directory))
      commandsByDirectory.set(directory, commandSchemas(directory, root));

    if ((await commandsByDirectory.get(directory))?.has(file)) continue;
    let parsed: JsonValue;

    try {
      const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

      if ((await fs.stat(file)).size > maxFileBytes) {
        errors.push(`${relFile}: file exceeds ${maxFileBytes} bytes`);
        continue;
      }

      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (!looksLikeJsonSchema(parsed)) continue;

    const schema = parsed;

    if (isJsonObject(schema['x-autocatalog']) && schema['x-autocatalog'].kind === 'command')
      continue;
    const embedded = readAutocatalogExtension(schema);
    const sidecar = await loadSidecarMeta(file);
    // Sidecar wins over x-autocatalog for declared overrides
    const meta = sidecar ? { ...embedded, ...sidecar } : embedded;

    const { event, finding } = eventFromJsonSchemaFile({
      schema,
      meta,
      relFile,
      fromSidecar: Boolean(sidecar),
    });

    candidates.push({ event, finding });
  }

  return {
    candidates,
    events: candidates.map((candidate) => candidate.event),
    findings: candidates.map((candidate) => candidate.finding),
    errors,
  };
}

export const jsonSchemaDiscoveryAdapter: DiscoveryAdapter = {
  name: 'json-schema',
  discover: ({ root, exclude, outDir, signal, limits }) =>
    discoverJsonSchemas({
      root,
      exclude,
      outDir,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};
