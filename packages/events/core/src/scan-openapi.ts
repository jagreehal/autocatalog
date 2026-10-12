import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  parseAdapterEventMeta,
  type AdapterEvent,
  type AdapterEventMeta,
  type ProvenanceValue,
} from './adapter-event';
import { isJsonObject, jsonObjectSchema, type JsonObject, type JsonValue } from './json';
import { derefLocal } from './json-ref';
import type {
  DiscoveryOutput,
  DiscoveryAdapter,
  DiscoveryCandidate,
  ScanFindingBase,
} from './merge-discoveries';
import { DEFAULT_SCAN_EXCLUDE, pascalCase } from './utils';

export interface ScanOpenApiOptions {
  root: string;
  exclude?: string[];
  outDir?: string;
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}

export const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'options',
  'head',
  'trace',
] as const;

export interface OpenApiScanFinding extends ScanFindingBase {
  kind: 'openapi-webhook' | 'openapi-callback' | 'openapi-operation';
  source: 'openapi';
}

type Doc = JsonObject;

/**
 * Cheap prefilter so we only YAML-parse files that claim to be OpenAPI.
 *
 * Not anchored to the start of a line: a JSON document written on one line —
 * which is how most tools emit it — puts `"openapi":"3.0.0"` in the middle of
 * the only line there is, and the anchored form skipped every one of them
 * silently, with no candidate and no error.
 */
const DECLARES_OPENAPI = /["']?openapi["']?\s*:\s*["']?3\./;

const openApi3 = z.looseObject({ openapi: z.string().startsWith('3.') });

export function looksLikeOpenApi(doc: unknown): doc is Doc {
  return openApi3.safeParse(doc).success && jsonObjectSchema.safeParse(doc).success;
}

/** Follow a local `$ref`; anything that does not land on an object is absent. */
function derefObject(doc: Doc, node: JsonValue | undefined): Doc | undefined {
  const resolved = derefLocal<JsonValue | undefined>(doc, node);

  return isJsonObject(resolved) ? resolved : undefined;
}

function objectOrEmpty(value: JsonValue | undefined): Doc {
  return isJsonObject(value) ? value : {};
}

function stringOrUndefined(value: JsonValue | undefined): string | undefined {
  const parsed = z.string().safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

/** `newPet` / `payment-completed` / `Payment Completed` → `new.pet` style ids. */
export function idFromOperationName(raw: string): string {
  const cleaned = String(raw)
    .replace(/^\/+/, '')
    .replace(/[/\s]+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '');

  if (!/[a-zA-Z0-9]/.test(cleaned)) return '';

  if (cleaned.includes('.')) return cleaned;

  if (cleaned.includes('-') || cleaned.includes('_')) {
    return cleaned.replace(/[-_]+/g, '.').toLowerCase();
  }

  return cleaned.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}

function requestContent(doc: Doc, operation: Doc): Doc {
  return objectOrEmpty(derefObject(doc, operation.requestBody)?.content);
}

function jsonBodySchema(doc: Doc, operation: Doc): Doc | undefined {
  const content = requestContent(doc, operation);

  // The event is what gets sent. Fall back to any +json media type before
  // giving up, since webhook specs routinely use application/vnd.x+json.
  const mediaType =
    Object.keys(content).find((type) => type === 'application/json') ??
    Object.keys(content).find((type) => type.includes('json'));

  if (!mediaType) return undefined;

  return derefObject(doc, objectOrEmpty(content[mediaType]).schema);
}

function extensionMeta(operation: Doc): AdapterEventMeta | undefined {
  const x = operation['x-autocatalog'];

  return isJsonObject(x) ? parseAdapterEventMeta(x) : undefined;
}

function examplesFor(doc: Doc, operation: Doc): Array<{ name: string; data: JsonValue }> {
  for (const value of Object.values(requestContent(doc, operation))) {
    const media = objectOrEmpty(value);

    if (media.example !== undefined) return [{ name: 'default', data: media.example }];

    if (isJsonObject(media.examples)) {
      return Object.entries(media.examples).flatMap(([name, example]) => {
        const data = derefObject(doc, example)?.value;

        return data === undefined ? [] : [{ name, data }];
      });
    }
  }

  return [];
}

function buildEvent(input: {
  doc: Doc;
  operation: Doc;
  nameHint: string;
  relFile: string;
  kind: OpenApiScanFinding['kind'];
}): { event: AdapterEvent; finding: OpenApiScanFinding } | undefined {
  const { doc, operation, nameHint, relFile, kind } = input;
  const schema = jsonBodySchema(doc, operation);

  if (!schema) return undefined;

  const meta = extensionMeta(operation);
  const operationId = stringOrUndefined(operation.operationId);
  const operationSummary = stringOrUndefined(operation.summary);
  const id = meta?.id ?? idFromOperationName(operationId ?? nameHint);

  if (!id) return undefined;

  const version = meta?.version ?? '0.1.0';
  const tag = Array.isArray(operation.tags) ? stringOrUndefined(operation.tags[0]) : undefined;
  const domain = meta?.domain ?? tag ?? id.split('.')[0]!;
  const folderName = pascalCase(id);
  const symbol = operationId ?? nameHint;

  const inferredFields: Record<string, ProvenanceValue> = {};

  if (!meta?.id) inferredFields.id = 'inferred';

  if (!meta?.version) inferredFields.version = 'inferred';

  if (!meta?.domain) inferredFields.domain = 'inferred';

  if (!meta?.summary) inferredFields.summary = 'inferred';

  // A webhook or callback is a declaration that this thing is an event; an
  // operation only lands here because someone opted it in by hand. Both beat
  // guessing from a file name, so neither is as speculative as a bare schema.
  const needsReview = !meta?.id || !meta?.version;
  const confidence = meta?.id && meta?.version ? 0.9 : 0.75;

  const event: AdapterEvent = {
    id,
    version,
    name: meta?.name ?? operationSummary ?? pascalCase(id).replace(/([a-z])([A-Z])/g, '$1 $2'),
    summary:
      meta?.summary ??
      stringOrUndefined(operation.description) ??
      operationSummary ??
      `Extracted from the OpenAPI ${kind.replace('openapi-', '')} \`${nameHint}\` in ${relFile} — review before trusting.`,
    domain,
    folderName,
    schema,
    examples:
      meta?.example !== undefined
        ? [{ name: 'default', data: meta.example }]
        : examplesFor(doc, operation),
    meta,
    source: { type: 'code', file: relFile, symbol },
    provenance: { default: meta ? 'extracted' : 'inferred', fields: inferredFields },
    confidence,
    needsReview,
  };

  return {
    event,
    finding: { file: relFile, symbol, kind, id, needsReview, source: 'openapi' },
  };
}

/**
 * Pull the event-shaped parts out of one OpenAPI document.
 *
 * Deliberately not every operation. A REST endpoint is a request/response
 * contract, not a message, and mapping all of them produces a catalog full of
 * CRUD noise that nobody believes. Only three things qualify:
 *
 *   - `webhooks:` — OpenAPI 3.1's own word for "this is an event"
 *   - `callbacks:` — the same idea attached to an operation
 *   - any operation carrying `x-autocatalog` — an explicit opt-in
 */
export function eventsFromOpenApiDocument(
  doc: Doc,
  relFile: string,
): Array<{ event: AdapterEvent; finding: OpenApiScanFinding }> {
  const found: Array<{ event: AdapterEvent; finding: OpenApiScanFinding }> = [];

  const push = (
    operation: JsonValue | undefined,
    nameHint: string,
    kind: OpenApiScanFinding['kind'],
  ): void => {
    if (!isJsonObject(operation)) return;
    const built = buildEvent({ doc, operation, nameHint, relFile, kind });

    if (built) found.push(built);
  };

  for (const [name, item] of Object.entries(objectOrEmpty(doc.webhooks))) {
    const resolved = derefObject(doc, item);

    for (const method of METHODS) push(resolved?.[method], name, 'openapi-webhook');
  }

  for (const [route, item] of Object.entries(objectOrEmpty(doc.paths))) {
    const pathItem = derefObject(doc, item);

    for (const method of METHODS) {
      const operation = pathItem?.[method];

      if (!isJsonObject(operation)) continue;

      for (const [callbackName, callback] of Object.entries(objectOrEmpty(operation.callbacks))) {
        const resolved = derefObject(doc, callback);

        for (const expression of Object.values(resolved ?? {})) {
          const target = derefObject(doc, expression);

          for (const cbMethod of METHODS) {
            push(target?.[cbMethod], callbackName, 'openapi-callback');
          }
        }
      }

      if (extensionMeta(operation)) {
        push(
          operation,
          stringOrUndefined(operation.operationId) ?? `${method}.${route}`,
          'openapi-operation',
        );
      }
    }
  }

  return found;
}

async function walkSpecFiles(
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
      } else if (entry.isFile() && /\.(ya?ml|json)$/i.test(entry.name)) {
        results.push(full);

        if (results.length > maxFiles) throw new Error(`spec file limit exceeded (${maxFiles})`);
      }
    }
  }

  await walk(root);

  return results;
}

/**
 * Every OpenAPI 3 document under a repo, parsed. Passive: reads files, never
 * executes repository code. Drift reuses this, so the documents it compares
 * are the ones the scan publishes.
 */
export async function findOpenApiDocuments(
  opts: ScanOpenApiOptions,
): Promise<{ documents: Array<{ relFile: string; doc: Doc; raw: string }>; errors: string[] }> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_SCAN_EXCLUDE, ...(opts.exclude ?? [])]);
  const outAbs = opts.outDir ? path.resolve(opts.outDir) : undefined;
  const files = await walkSpecFiles(root, exclude, outAbs, opts.signal, opts.maxFiles);

  const documents: Array<{ relFile: string; doc: Doc; raw: string }> = [];
  const errors: string[] = [];

  for (const file of files) {
    opts.signal?.throwIfAborted();
    // Forward slashes on every platform: the path is recorded and matched against CODEOWNERS.
    const relFile = path.relative(root, file).split(path.sep).join('/');

    let raw: string;

    try {
      const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

      if ((await fs.stat(file)).size > maxFileBytes) continue;
      raw = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }

    // Most files in a repo are not OpenAPI. Parsing every YAML to find out is
    // the expensive way to learn nothing.
    if (!DECLARES_OPENAPI.test(raw)) continue;

    let doc: unknown;

    try {
      doc = file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (looksLikeOpenApi(doc)) documents.push({ relFile, doc, raw });
  }

  return { documents, errors };
}

/**
 * Discover OpenAPI documents in a repo and map their event-shaped parts to
 * AdapterEvents. Passive: parses specs, never executes repository code.
 */
export async function discoverOpenApi(opts: ScanOpenApiOptions): Promise<DiscoveryOutput> {
  const { documents, errors } = await findOpenApiDocuments(opts);
  const candidates: DiscoveryCandidate[] = [];

  for (const { relFile, doc } of documents) {
    try {
      candidates.push(...eventsFromOpenApiDocument(doc, relFile));
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

export const openApiDiscoveryAdapter: DiscoveryAdapter = {
  name: 'openapi',
  discover: ({ root, exclude, outDir, signal, limits }) =>
    discoverOpenApi({
      root,
      exclude,
      outDir,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};
