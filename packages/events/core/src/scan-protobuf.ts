import fs from 'node:fs/promises';
import path from 'node:path';
import { Enum, Namespace, parse as parseProto, Service, Type } from 'protobufjs';
import {
  parseAdapterEventMeta,
  type AdapterEvent,
  type AdapterEventMeta,
  type ProvenanceValue,
} from './adapter-event';
import { jsonObjectSchema, type JsonObject } from './json';
import type {
  DiscoveryOutput,
  DiscoveryAdapter,
  DiscoveryCandidate,
  ScanFindingBase,
} from './merge-discoveries';
import { DEFAULT_SCAN_EXCLUDE, pascalCase } from './utils';

export interface ScanProtobufOptions {
  root: string;
  exclude?: string[];
  outDir?: string;
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface ProtobufScanFinding extends ScanFindingBase {
  kind: 'protobuf';
  source: 'protobuf';
}

/**
 * proto3's canonical JSON mapping, which is what actually travels on a bus.
 * 64-bit integers are strings there, not numbers — JSON cannot hold them.
 */
const SCALARS = new Map<string, JsonObject>(
  Object.entries<JsonObject>({
    double: { type: 'number' },
    float: { type: 'number' },
    int32: { type: 'integer' },
    uint32: { type: 'integer' },
    sint32: { type: 'integer' },
    fixed32: { type: 'integer' },
    sfixed32: { type: 'integer' },
    int64: { type: 'string', format: 'int64' },
    uint64: { type: 'string', format: 'int64' },
    sint64: { type: 'string', format: 'int64' },
    fixed64: { type: 'string', format: 'int64' },
    sfixed64: { type: 'string', format: 'int64' },
    bool: { type: 'boolean' },
    string: { type: 'string' },
    bytes: { type: 'string', contentEncoding: 'base64' },
  }),
);

const WELL_KNOWN = new Map<string, JsonObject>(
  Object.entries<JsonObject>({
    'google.protobuf.Timestamp': { type: 'string', format: 'date-time' },
    'google.protobuf.Duration': { type: 'string' },
    'google.protobuf.StringValue': { type: 'string' },
    'google.protobuf.BoolValue': { type: 'boolean' },
    'google.protobuf.Int32Value': { type: 'integer' },
    'google.protobuf.Int64Value': { type: 'string', format: 'int64' },
    'google.protobuf.DoubleValue': { type: 'number' },
    'google.protobuf.FloatValue': { type: 'number' },
    'google.protobuf.Struct': { type: 'object' },
    'google.protobuf.Any': { type: 'object' },
  }),
);

const AUTOCATALOG_OPTION = /^\((?:autocatalog\.)?(\w+)\)$/;

/** `option (autocatalog.id) = "order.placed";` → declared metadata. */
export function metaFromOptions(options: JsonObject | undefined): AdapterEventMeta | undefined {
  if (!options) return undefined;
  const meta: JsonObject = {};

  for (const [key, value] of Object.entries(options)) {
    const match = AUTOCATALOG_OPTION.exec(key);

    if (match && key.includes('autocatalog')) meta[match[1]!] = value;
  }

  return Object.keys(meta).length > 0 ? parseAdapterEventMeta(meta) : undefined;
}

/** `PaymentCompleted` → `payment.completed` */
export function idFromMessageName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1.$2')
    .replace(/[-_]+/g, '.')
    .toLowerCase();
}

function resolveType(typeName: string, from: Type, open: Set<string>): JsonObject {
  const known = SCALARS.get(typeName) ?? WELL_KNOWN.get(typeName);

  if (known) return { ...known };

  const target = from.lookup(typeName);

  if (target instanceof Enum) {
    // Names travel in proto3 JSON, not the numbers.
    return { type: 'string', enum: Object.keys(target.values) };
  }

  if (!(target instanceof Type)) return {};

  if (open.has(target.fullName)) {
    return { type: 'object', description: `recursive reference to ${typeName}` };
  }

  return messageToJsonSchema(target, open);
}

export function messageToJsonSchema(message: Type, open: Set<string> = new Set()): JsonObject {
  const fullName = message.fullName;
  open.add(fullName);

  const properties: JsonObject = {};
  const required: string[] = [];

  for (const field of Object.values(message.fields)) {
    let schema = resolveType(field.type, message, open);

    if (field.map) {
      schema = { type: 'object', additionalProperties: schema };
    } else if (field.repeated) {
      schema = { type: 'array', items: schema };
    }

    if (field.comment) schema.description = field.comment;
    properties[field.name] = schema;

    // proto3 has no required fields, but a singular field without `optional`
    // always decodes to a value (its zero value), so it is always present in
    // the payload a consumer sees. An `optional` field genuinely may be absent,
    // and repeated/map fields default to empty.
    //
    // Not `field.optional`: protobufjs reports every proto3 field as optional,
    // since the wire format has no required. Explicit presence shows up as the
    // proto3_optional option (and the synthetic oneof it generates) instead.
    const explicitlyOptional =
      field.options?.proto3_optional === true || (field.partOf?.name ?? '').startsWith('_');

    if (!explicitlyOptional && !field.repeated && !field.map) required.push(field.name);
  }

  open.delete(fullName);

  const built: JsonObject = { type: 'object', properties };

  if (required.length > 0) built.required = required;

  if (message.comment) built.description = message.comment;

  return built;
}

/** Message type names used as an RPC request or response anywhere in the file. */
export function rpcTypeNames(root: Namespace): Set<string> {
  const names = new Set<string>();

  const visit = (node: Namespace): void => {
    for (const child of Object.values(node.nested ?? {})) {
      if (child instanceof Service) {
        for (const method of Object.values(child.methods)) {
          if (method.requestType) names.add(method.requestType.replace(/^\./, ''));

          if (method.responseType) names.add(method.responseType.replace(/^\./, ''));
        }
      }

      if (child instanceof Namespace) visit(child);
    }
  };

  visit(root);

  return names;
}

/**
 * Map the event-shaped messages in one `.proto` to AdapterEvents.
 *
 * Messages wired to an RPC are skipped: a request/response pair is a call, not
 * a message anyone subscribes to, and publishing both halves of every gRPC
 * method is how a catalog fills up with things nobody emits. Nested messages
 * are skipped too — they are the structure of their parent, not events.
 */
export function eventsFromProtoRoot(
  root: Namespace,
  packageName: string | undefined,
  relFile: string,
): Array<{ event: AdapterEvent; finding: ProtobufScanFinding }> {
  const rpcTypes = rpcTypeNames(root);
  const found: Array<{ event: AdapterEvent; finding: ProtobufScanFinding }> = [];

  const container = packageName
    ? packageName.split('.').reduce<Namespace | undefined>((node, seg) => {
        const next = node?.nested?.[seg];

        return next instanceof Namespace ? next : undefined;
      }, root)
    : root;

  for (const message of Object.values(container?.nested ?? {})) {
    if (!(message instanceof Type)) continue; // enums, services and sub-packages
    const fullName = message.fullName.replace(/^\./, '');

    if (rpcTypes.has(fullName) || rpcTypes.has(message.name)) continue;

    const options = jsonObjectSchema.safeParse(message.options);
    const meta = metaFromOptions(options.success ? options.data : undefined);
    const id = meta?.id ?? idFromMessageName(message.name);
    const version = meta?.version ?? '0.1.0';
    const domain = meta?.domain ?? packageName?.split('.').pop() ?? id.split('.')[0]!;
    const needsReview = !meta?.id || !meta?.version;

    const inferredFields: Record<string, ProvenanceValue> = {};

    if (!meta?.id) inferredFields.id = 'inferred';

    if (!meta?.version) inferredFields.version = 'inferred';

    if (!meta?.domain) inferredFields.domain = 'inferred';

    if (!meta?.summary) inferredFields.summary = 'inferred';

    found.push({
      event: {
        id,
        version,
        name: meta?.name ?? message.name,
        summary:
          meta?.summary ??
          message.comment ??
          `Extracted from the protobuf message \`${message.name}\` in ${relFile} — review before trusting.`,
        domain,
        folderName: pascalCase(id),
        schema: messageToJsonSchema(message),
        examples: meta?.example !== undefined ? [{ name: 'default', data: meta.example }] : [],
        meta,
        source: { type: 'code', file: relFile, symbol: message.name },
        provenance: { default: meta ? 'extracted' : 'inferred', fields: inferredFields },
        confidence: meta?.id && meta?.version ? 0.9 : 0.7,
        needsReview,
      },
      finding: {
        file: relFile,
        symbol: message.name,
        kind: 'protobuf',
        id,
        needsReview,
        source: 'protobuf',
      },
    });
  }

  return found;
}

async function walkProtoFiles(
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
      } else if (entry.isFile() && /\.proto$/i.test(entry.name)) {
        results.push(full);

        if (results.length > maxFiles) throw new Error(`proto file limit exceeded (${maxFiles})`);
      }
    }
  }

  await walk(root);

  return results;
}

/**
 * Discover protobuf messages and map them to AdapterEvents. Passive: parses
 * `.proto` text, never executes repository code and never resolves imports off
 * disk — a type from another file stays an empty schema rather than a guess.
 */
export async function discoverProtobuf(opts: ScanProtobufOptions): Promise<DiscoveryOutput> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_SCAN_EXCLUDE, ...(opts.exclude ?? [])]);
  const outAbs = opts.outDir ? path.resolve(opts.outDir) : undefined;
  const files = await walkProtoFiles(root, exclude, outAbs, opts.signal, opts.maxFiles);

  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];

  for (const file of files) {
    opts.signal?.throwIfAborted();
    // Forward slashes on every platform: the path is recorded and matched against CODEOWNERS.
    const relFile = path.relative(root, file).split(path.sep).join('/');
    let source: string;

    try {
      const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

      if ((await fs.stat(file)).size > maxFileBytes) {
        errors.push(`${relFile}: file exceeds ${maxFileBytes} bytes`);
        continue;
      }

      source = await fs.readFile(file, 'utf8');
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    try {
      const parsed = parseProto(source, { keepCase: true, alternateCommentMode: true });
      candidates.push(...eventsFromProtoRoot(parsed.root, parsed.package ?? undefined, relFile));
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

export const protobufDiscoveryAdapter: DiscoveryAdapter = {
  name: 'protobuf',
  discover: ({ root, exclude, outDir, signal, limits }) =>
    discoverProtobuf({
      root,
      exclude,
      outDir,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};
