import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseAdapterEventMeta, type AdapterEvent } from './adapter-event';
import { compareSemverish } from './drift';
import { isJsonObject, jsonObjectSchema, type JsonObject, type JsonValue } from './json';
import { rewriteObjectRefs } from './json-ref';
import type {
  DiscoverResult,
  DiscoveryAdapter,
  DiscoveryCandidate,
  DiscoveryContext,
} from './merge-discoveries';
import { readOptionalResourceJson, ResourceReadError } from './resource-files';
import { pascalCase } from './utils';

/**
 * The file an organisation describes its conventions in. Document kinds live
 * here too, so a team learns one file.
 */
export const CONVENTIONS_PATH = 'contracts/autocatalog.conventions.json';

const PLACEHOLDER = /(\{id\}|\{version\})/;

const count = (template: string, placeholder: string) => template.split(placeholder).length - 1;

const matchPattern = z
  .string()
  .refine((template) => count(template, '{id}') === 1 && count(template, '{version}') <= 1, {
    error: 'a pattern holds {id} once and {version} at most once, such as v{version}.{id}',
  });

/**
 * Where events are when a repository keeps them its own way. A mapping is data:
 * it runs nothing, so any repository can be read with one.
 */
export const eventSourceSchema = z.strictObject({
  kind: z.literal('event'),
  /** Files relative to the repository, each one object with an event per key. */
  files: z.array(z.string().min(1)).min(1),
  /** How a key names an event, first match wins: `v{version}.{id}`. */
  match: z.array(matchPattern).min(1),
  domain: z.string().min(1),
  /** What the file cannot say, declared once for all its events. */
  meta: jsonObjectSchema.optional(),
});

export type EventSource = z.infer<typeof eventSourceSchema>;

export const conventionSourcesSchema = z.array(eventSourceSchema);

// `kinds` belongs to the docs package, which checks it.
const conventionsFile = z.looseObject({ sources: conventionSourcesSchema.default([]) });

/**
 * A pattern as a regular expression. Only `{id}` and `{version}` are special,
 * so a shared file cannot hold an expression that hangs a scan.
 */
const compile = (template: string): RegExp => {
  const parts = template.split(PLACEHOLDER).map((part) => {
    if (part === '{id}') return '(?<id>.+)';

    if (part === '{version}') return String.raw`(?<version>\d+(?:\.\d+){0,2})`;

    return part.replace(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);
  });

  return new RegExp(`^${parts.join('')}$`);
};

/** `1` and `1.2` as the full versions the catalog holds. */
const fullVersion = (version: string): string =>
  [...version.split('.'), '0', '0'].slice(0, 3).join('.');

/**
 * A generator given a name wraps the schema: a root `$ref` to a definition of
 * that name, with any `/` in it left unescaped. Lift the definition to the root,
 * so paths read `detail.amount` and its references resolve.
 */
const unwrapNamed = (schema: JsonObject, key: string): JsonObject => {
  const { $ref, definitions, ...rest } = schema;
  const written = `#/definitions/${key}`;
  const { [key]: body, ...others } = isJsonObject(definitions) ? definitions : {};

  if ($ref !== written || !isJsonObject(body)) return schema;

  const lifted = { ...rest, ...body };

  return rewriteObjectRefs(
    Object.keys(others).length > 0 ? { ...lifted, definitions: others } : lifted,
    (ref) =>
      ref === written || ref.startsWith(`${written}/`) ? `#${ref.slice(written.length)}` : ref,
  );
};

const eventFromEntry = (
  key: string,
  written: JsonObject,
  named: { id: string; version?: string | undefined },
  source: EventSource,
  file: string,
): DiscoveryCandidate => {
  const { id, version } = named;
  const schema = unwrapNamed(written, key);

  const { title, description } = z
    .looseObject({ title: z.string().optional(), description: z.string().optional() })
    .catch({})
    .parse(schema);

  // The id as it is: `payment.failed` and `payment-failed` are different events.
  const folderName = id.replaceAll('/', '-');

  const event: AdapterEvent = {
    id,
    version: version ? fullVersion(version) : '0.1.0',
    name: title ?? pascalCase(id).replace(/([a-z])([A-Z])/g, '$1 $2'),
    summary: description ?? `Read from ${file} by a convention.`,
    domain: source.domain,
    folderName,
    schema,
    examples: [],
    meta: source.meta && parseAdapterEventMeta(source.meta),
    source: { type: 'code', file, symbol: key },
    provenance: { default: 'extracted', fields: version ? {} : { version: 'inferred' } },
    confidence: version ? 0.9 : 0.65,
    needsReview: !version,
  };

  return {
    event,
    finding: {
      file,
      symbol: key,
      kind: 'convention',
      id,
      needsReview: !version,
      source: 'convention',
    },
  };
};

const readConventions = async ({
  root,
  conventions,
}: DiscoveryContext): Promise<JsonValue | undefined> =>
  conventions
    ? JSON.parse(await fs.readFile(conventions, 'utf8'))
    : readOptionalResourceJson(path.join(root, CONVENTIONS_PATH), { root });

const readSource = async (
  source: EventSource,
  { root, limits }: DiscoveryContext,
  result: Required<DiscoverResult>,
): Promise<void> => {
  const patterns = source.match.map(compile);

  for (const file of source.files) {
    let entries: JsonValue | undefined;

    try {
      entries = await readOptionalResourceJson(path.join(root, file), {
        root,
        maxFileBytes: limits?.maxFileBytes,
      });
    } catch (error) {
      if (!(error instanceof ResourceReadError)) throw error;

      result.errors.push(error.message);
      continue;
    }

    if (entries === undefined) {
      result.skipped.push(`${file}: a convention names it and this repository has no such file`);
      continue;
    }

    if (!isJsonObject(entries)) {
      result.errors.push(`${file}: a convention reads an object with an event per key`);
      continue;
    }

    for (const [key, schema] of Object.entries(entries)) {
      const groups = patterns.map((pattern) => pattern.exec(key)?.groups).find(Boolean);

      if (!groups?.id || !isJsonObject(schema)) {
        result.skipped.push(`${file}: "${key}" fits no pattern in the convention`);
        continue;
      }

      result.candidates.push(
        eventFromEntry(key, schema, { id: groups.id, version: groups.version }, source, file),
      );
    }
  }
};

/**
 * The catalog keeps one current version of an event, so choose it here: left to
 * the merge, equal confidence would settle it by name and publish the oldest.
 */
const keepNewest = ({ candidates, skipped }: Required<DiscoverResult>): DiscoveryCandidate[] => {
  const newest = new Map<string, DiscoveryCandidate>();

  for (const candidate of candidates) {
    const { id, version } = candidate.event;
    const kept = newest.get(id);

    if (!kept || compareSemverish(version, kept.event.version) > 0) newest.set(id, candidate);
  }

  return candidates.filter((candidate) => {
    const kept = newest.get(candidate.event.id)!;

    if (kept === candidate) return true;

    const relation = candidate.event.version === kept.event.version ? 'repeats' : 'is older than';

    skipped.push(
      `${candidate.finding.file}: "${candidate.finding.symbol}" ${relation} ${kept.event.version}, the version published`,
    );

    return false;
  });
};

/**
 * The files a repository's own conventions file reads, for looking them up in
 * its history. Unreadable or invalid is none: discovery reports that, not this.
 */
export const conventionFiles = async (root: string): Promise<string[]> => {
  const value = await readOptionalResourceJson(path.join(root, CONVENTIONS_PATH), { root }).catch(
    () => undefined,
  );

  const parsed = conventionsFile.safeParse(value);
  const files = parsed.success ? parsed.data.sources.flatMap((source) => source.files) : [];

  return files.filter(
    (file) => !path.isAbsolute(file) && !path.posix.normalize(file).startsWith('..'),
  );
};

/** Events a repository keeps its own way, read through its conventions file. */
export const conventionDiscoveryAdapter: DiscoveryAdapter = {
  name: 'convention',
  async discover(context) {
    const result: Required<DiscoverResult> = { candidates: [], errors: [], skipped: [] };
    const label = context.conventions ?? CONVENTIONS_PATH;
    let value: JsonValue | undefined;

    try {
      value = await readConventions(context);
    } catch (error) {
      result.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);

      return result;
    }

    if (value === undefined) return result;

    const parsed = conventionsFile.safeParse(value);

    if (!parsed.success) {
      result.errors.push(`${label}: ${z.prettifyError(parsed.error)}`);

      return result;
    }

    for (const source of parsed.data.sources) await readSource(source, context, result);

    return { ...result, candidates: keepNewest(result) };
  },
};
