import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readVendorMeta } from './adapter-event';
import type { AdapterEvent, ProvenanceValue } from './adapter-event';
import { jsonValueSchema, type JsonObject, type JsonValue } from './json';
import type {
  DiscoveryOutput,
  DiscoveryAdapter,
  DiscoveryCandidate,
  ScanFindingBase,
} from './merge-discoveries';
import { DEFAULT_SCAN_EXCLUDE, pascalCase } from './utils';

export interface ScanAvroOptions {
  root: string;
  exclude?: string[];
  outDir?: string;
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface AvroScanFinding extends ScanFindingBase {
  kind: 'avro';
  source: 'avro';
}

/** An Avro schema: a type name, a union of schemas, or a complex type object. */
type AvroType = string | AvroType[] | AvroNode;

type AvroNode = {
  type: AvroType;
  name?: string;
  namespace?: string;
  doc?: string;
  logicalType?: string;
  fields?: AvroField[];
  symbols?: string[];
  items?: AvroType;
  values?: AvroType;
};

const lazyAvroType = z.lazy((): z.ZodType<AvroType> => avroType);

const avroField = z.object({
  name: z.string(),
  type: lazyAvroType,
  doc: z.string().optional(),
  default: jsonValueSchema.optional(),
});

type AvroField = z.infer<typeof avroField>;

// Extra keys (`aliases`, `x-autocatalog`, …) are allowed and left to their readers.
const avroNode = z.object({
  type: lazyAvroType,
  name: z.string().optional(),
  namespace: z.string().optional(),
  doc: z.string().optional(),
  logicalType: z.string().optional(),
  fields: z.array(avroField).optional(),
  symbols: z.array(z.string()).optional(),
  items: lazyAvroType.optional(),
  values: lazyAvroType.optional(),
});

const avroType: z.ZodType<AvroType> = z.union([z.string(), z.array(lazyAvroType), avroNode]);

/** A named record: the only top-level Avro schema that can become an event. */
const avroRecord = avroNode.extend({
  type: z.literal('record'),
  name: z.string(),
  fields: z.array(avroField),
});

type AvroRecord = z.infer<typeof avroRecord>;

/** Avro primitive → JSON Schema `type`. */
const PRIMITIVES = new Map([
  ['null', 'null'],
  ['boolean', 'boolean'],
  ['int', 'integer'],
  ['long', 'integer'],
  ['float', 'number'],
  ['double', 'number'],
  ['bytes', 'string'],
  ['string', 'string'],
]);

/** Logical types that carry a JSON Schema `format` worth keeping. */
const LOGICAL_FORMATS = new Map([
  ['date', 'date'],
  ['timestamp-millis', 'date-time'],
  ['timestamp-micros', 'date-time'],
  ['uuid', 'uuid'],
]);

export function looksLikeAvroSchema(value: unknown): value is AvroRecord {
  return avroRecord.safeParse(value).success;
}

/** Registry references contribute named types before the payload is projected. */
export function avroSchemaToJsonSchema(input: JsonValue, references: JsonValue[] = []): JsonObject {
  const named = new Map<string, AvroType>();

  const collect = (value: AvroType) => {
    if (Array.isArray(value)) {
      value.forEach(collect);

      return;
    }

    const parsed = avroNode.safeParse(value);

    if (!parsed.success) return;
    const node = parsed.data;

    if (node.name) {
      named.set(node.name, node);

      if (node.namespace) named.set(`${node.namespace}.${node.name}`, node);
    }

    for (const field of node.fields ?? []) collect(field.type);

    if (node.items) collect(node.items);

    if (node.values) collect(node.values);
  };

  references.map((reference) => avroType.parse(reference)).forEach(collect);
  const schema = avroType.parse(input);
  collect(schema);

  return toJsonSchema(schema, named, new Set());
}

/**
 * Convert one Avro schema node to JSON Schema.
 *
 * Named records are inlined at every use rather than emitted as `$ref` into
 * `$defs`. Duplication is legal JSON Schema and keeps the event's payload a
 * plain object that the differ, validator and field index can all walk without
 * resolving pointers. `open` holds the records currently being built, so a
 * genuinely self-referencing record terminates instead of recursing forever.
 */
function toJsonSchema(
  node: AvroType | undefined,
  named: Map<string, AvroType>,
  open: Set<string>,
): JsonObject {
  // An `array` without `items` or a `map` without `values`: nothing to describe.
  if (node === undefined) return {};

  if (isAvroName(node)) {
    const primitive = PRIMITIVES.get(node);

    if (primitive) return { type: primitive };
    const referenced = named.get(node);

    if (!referenced) return {};

    if (open.has(node)) {
      return { type: 'object', description: `recursive reference to ${node}` };
    }

    return toJsonSchema(referenced, named, open);
  }

  if (Array.isArray(node)) {
    // A union. `["null", "string"]` is Avro for "optional string" — the null
    // branch is what makes a field optional, and the caller strips it.
    const branches = node.map((branch) => toJsonSchema(branch, named, open));

    return branches.length === 1 ? branches[0]! : { anyOf: branches };
  }

  const logical = node.logicalType ? LOGICAL_FORMATS.get(node.logicalType) : undefined;

  switch (node.type) {
    case 'record': {
      const name = node.name;

      if (name) {
        named.set(name, node);

        if (open.has(name)) {
          return { type: 'object', description: `recursive reference to ${name}` };
        }

        open.add(name);
      }

      const properties: JsonObject = {};
      const required: string[] = [];

      for (const field of node.fields ?? []) {
        const optional = isNullableUnion(field.type);
        const schema = toJsonSchema(stripNull(field.type), named, open);

        if (field.doc !== undefined) schema.description = field.doc;
        properties[field.name] = schema;

        // A field with a default can be omitted by a producer; without one it
        // is always present on the wire.
        if (!optional && field.default === undefined) required.push(field.name);
      }

      if (name) open.delete(name);

      const built: JsonObject = { type: 'object', properties };

      if (required.length > 0) built.required = required;

      if (node.doc !== undefined) built.description = node.doc;

      return built;
    }

    case 'enum':
      return { type: 'string', enum: node.symbols ?? [] };
    case 'array':
      return { type: 'array', items: toJsonSchema(node.items, named, open) };
    case 'map':
      return { type: 'object', additionalProperties: toJsonSchema(node.values, named, open) };
    case 'fixed':
      return { type: 'string' };
    default: {
      if (!isAvroName(node.type)) return {};
      const primitive = PRIMITIVES.get(node.type);

      if (primitive) return logical ? { type: primitive, format: logical } : { type: primitive };
      const referenced = named.get(node.type);

      return referenced ? toJsonSchema(referenced, named, open) : {};
    }
  }
}

/** A parsed Avro type that is a name (primitive or named type), not a union or object. */
function isAvroName(type: AvroType): type is string {
  return z.string().safeParse(type).success;
}

function isNullableUnion(type: AvroType): boolean {
  return Array.isArray(type) && type.some((branch) => branch === 'null');
}

function stripNull(type: AvroType): AvroType {
  if (!Array.isArray(type)) return type;
  const rest = type.filter((branch) => branch !== 'null');

  return rest.length === 1 ? rest[0]! : rest;
}

/** `com.acme.PaymentCompleted` → `payment.completed` */
export function idFromAvroName(name: string, namespace?: string): string {
  const local = String(name).split('.').pop() ?? name;

  const dotted = local
    .replace(/([a-z0-9])([A-Z])/g, '$1.$2')
    .replace(/[-_]+/g, '.')
    .toLowerCase();

  // A namespace like com.acme.payments contributes the domain, not the id.
  void namespace;

  return dotted;
}

export function avroDomain(schema: AvroRecord, relFile: string, fallbackId: string): string {
  const last = schema.namespace?.split('.').pop();

  if (last && !['avro', 'schema', 'schemas'].includes(last)) return last;
  const parts = relFile.split(/[/\\]/).filter(Boolean);
  const skip = new Set(['src', 'lib', 'avro', 'schemas', 'schema', 'events', '.']);

  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i]!;

    if (!skip.has(seg.toLowerCase())) return seg;
  }

  return fallbackId.split('.')[0]!;
}

export function eventFromAvroSchema(
  schema: AvroRecord,
  relFile: string,
): DiscoveryCandidate<AvroScanFinding> {
  const meta = readVendorMeta(schema);

  const id = meta?.id ?? idFromAvroName(schema.name, schema.namespace);
  const version = meta?.version ?? '0.1.0';
  const domain = meta?.domain ?? avroDomain(schema, relFile, id);
  const folderName = pascalCase(id);

  const inferredFields: Record<string, ProvenanceValue> = {};

  if (!meta?.id) inferredFields.id = 'inferred';

  if (!meta?.version) inferredFields.version = 'inferred';

  if (!meta?.domain) inferredFields.domain = 'inferred';

  if (!meta?.summary) inferredFields.summary = 'inferred';

  const needsReview = !meta?.id || !meta?.version;

  const event: AdapterEvent = {
    id,
    version,
    name: meta?.name ?? schema.name,
    summary:
      meta?.summary ??
      schema.doc ??
      `Extracted from the Avro record \`${schema.name}\` in ${relFile} — review before trusting.`,
    domain,
    folderName,
    schema: toJsonSchema(schema, new Map(), new Set()),
    examples: meta?.example !== undefined ? [{ name: 'default', data: meta.example }] : [],
    meta,
    source: { type: 'code', file: relFile, symbol: schema.name },
    provenance: { default: meta ? 'extracted' : 'inferred', fields: inferredFields },
    // An .avsc file is unambiguously a schema, so this beats guessing from a
    // JSON file that merely looks schema-shaped.
    confidence: meta?.id && meta?.version ? 0.9 : 0.75,
    needsReview,
  };

  return {
    event,
    finding: {
      file: relFile,
      symbol: schema.name,
      kind: 'avro',
      id,
      needsReview,
      source: 'avro',
    },
  };
}

async function walkAvroFiles(
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
      } else if (entry.isFile() && /\.avsc$/i.test(entry.name)) {
        results.push(full);

        if (results.length > maxFiles) throw new Error(`Avro file limit exceeded (${maxFiles})`);
      }
    }
  }

  await walk(root);

  return results;
}

/**
 * Discover Avro record schemas (`.avsc`) and map them to AdapterEvents.
 * Passive: parses schema files, never executes repository code.
 *
 * Only `.avsc` — an Avro schema is legal JSON, but so is everything else in a
 * repository, and guessing which `.json` files are Avro is how a scan starts
 * inventing events.
 */
export async function discoverAvro(opts: ScanAvroOptions): Promise<DiscoveryOutput> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_SCAN_EXCLUDE, ...(opts.exclude ?? [])]);
  const outAbs = opts.outDir ? path.resolve(opts.outDir) : undefined;
  const files = await walkAvroFiles(root, exclude, outAbs, opts.signal, opts.maxFiles);

  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];

  for (const file of files) {
    opts.signal?.throwIfAborted();
    // Forward slashes on every platform: the path is recorded and matched against CODEOWNERS.
    const relFile = path.relative(root, file).split(path.sep).join('/');
    let parsed: unknown;

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

    // A .avsc holding a bare union or primitive is valid Avro but has no name
    // to become an event id, so there is nothing honest to publish.
    if (!looksLikeAvroSchema(parsed)) continue;

    try {
      candidates.push(eventFromAvroSchema(parsed, relFile));
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    candidates,
    events: candidates.map((candidate) => candidate.event),
    findings: candidates.map((candidate) => candidate.finding),
    errors,
  };
}

export const avroDiscoveryAdapter: DiscoveryAdapter = {
  name: 'avro',
  discover: ({ root, exclude, outDir, signal, limits }) =>
    discoverAvro({
      root,
      exclude,
      outDir,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};
