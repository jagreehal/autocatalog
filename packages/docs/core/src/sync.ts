import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type JsonObject,
  type JsonValue,
  jsonObjectSchema,
  jsonValueSchema,
} from 'autocatalog-core';
import { z } from 'zod';
import { DOCS_SCHEMA_PATH } from './frontmatter';

/**
 * Keep a repository's copy of the organisation's contract honest.
 *
 * A repository that runs its own CI needs the contract locally — a relative
 * path into a sibling checkout only resolves for someone who has every repo
 * cloned side by side. So the copy is committed, and a committed copy drifts
 * the day the organisation edits the original.
 *
 * This closes that: the copy records where it came from in `$id`, the standard
 * JSON Schema keyword for exactly this, and drift becomes a failing command
 * rather than a surprise. Fetching stays a separate step from `ac docs check`,
 * so validation never needs the network.
 */
export interface SyncContractOptions {
  /** Override the source. A URL, or a path to the upstream file. */
  from?: string;
  /** Update the local copy instead of only reporting the difference. */
  write?: boolean;
  /** Injected so tests never touch the network. */
  fetchJson?: (url: string) => Promise<JsonValue>;
}

export type SyncContractStatus =
  'in-sync' | 'drifted' | 'written' | 'missing-local' | 'no-source' | 'unreachable';

export interface SyncContractResult {
  status: SyncContractStatus;
  /** Where upstream was read from, once known. */
  source: string | null;
  /** Absolute path of the local copy. */
  file: string;
  /** Field-level differences, in the order a reader wants them. */
  changes: string[];
  /** Set when the source could not be read. */
  error?: string;
}

async function defaultFetchJson(url: string): Promise<JsonValue> {
  // https only: this writes a file that decides what every document in the
  // repository must satisfy, so it is not something to take over plain http.
  if (!url.startsWith('https://'))
    throw new Error(`refusing to fetch over a non-https URL: ${url}`);
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url} returned ${response.status}`);

  return jsonValueSchema.parse(await response.json());
}

function isUrl(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(source);
}

/** The keywords a contract change is described in; the rest ride along. */
const contractKeywords = z.looseObject({
  $id: z.string().optional().catch(undefined),
  properties: jsonObjectSchema.optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: jsonValueSchema.optional(),
});

/** Top-level differences, described the way a reviewer would say them. */
export function describeContractChanges(local: JsonObject, upstream: JsonObject): string[] {
  const changes: string[] = [];
  const localKeywords = contractKeywords.parse(local);
  const upstreamKeywords = contractKeywords.parse(upstream);

  const localProps = localKeywords.properties ?? {};
  const upstreamProps = upstreamKeywords.properties ?? {};

  for (const field of Object.keys(upstreamProps)) {
    if (!(field in localProps)) changes.push(`+ field ${field}`);
    else if (!isDeepStrictEqual(localProps[field], upstreamProps[field])) {
      changes.push(`~ field ${field} changed`);
    }
  }

  for (const field of Object.keys(localProps)) {
    if (!(field in upstreamProps)) changes.push(`- field ${field} removed upstream`);
  }

  const localRequired = new Set(localKeywords.required ?? []);
  const upstreamRequired = new Set(upstreamKeywords.required ?? []);

  for (const field of upstreamRequired) {
    // The change most likely to fail a build that was passing this morning.
    if (!localRequired.has(field)) changes.push(`! ${field} is now required`);
  }

  for (const field of localRequired) {
    if (!upstreamRequired.has(field)) changes.push(`~ ${field} is no longer required`);
  }

  if (Boolean(local.additionalProperties) !== Boolean(upstream.additionalProperties)) {
    changes.push(
      upstream.additionalProperties === false
        ? '! the contract is now closed (additionalProperties: false)'
        : '~ the contract is now open (additionalProperties: true)',
    );
  }

  return changes;
}

/**
 * Compare the local contract with the organisation's, and optionally update it.
 *
 * The source is `--from`, else the `$id` the local copy records. Without either
 * there is nothing to sync against, which is a state worth reporting rather
 * than guessing at.
 */
export async function syncFrontmatterContract(
  root: string,
  options: SyncContractOptions = {},
): Promise<SyncContractResult> {
  const file = path.join(path.resolve(root), DOCS_SCHEMA_PATH);
  const base: Omit<SyncContractResult, 'status'> = { source: null, file, changes: [] };

  if (!fs.existsSync(file)) {
    return { ...base, status: 'missing-local' };
  }

  const local = jsonObjectSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));

  const source = options.from ?? contractKeywords.parse(local).$id ?? null;

  if (!source) return { ...base, status: 'no-source' };

  let upstream: JsonObject;

  try {
    const raw = isUrl(source)
      ? await (options.fetchJson ?? defaultFetchJson)(source)
      : JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));

    const parsed = jsonObjectSchema.safeParse(raw);

    if (!parsed.success) throw new Error('the source is not a JSON Schema object');

    upstream = parsed.data;
  } catch (error) {
    return {
      ...base,
      source,
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const changes = describeContractChanges(local, upstream);

  // Compared on content, not on the change list: a difference this summary does
  // not describe is still a difference, and silently calling it in-sync would
  // make the whole command untrustworthy. Deep equality rather than serialised
  // text, because JSON object key order carries no meaning and failing a build
  // over it would be drift the reviewer cannot even see.
  if (isDeepStrictEqual(local, upstream)) {
    return { ...base, source, status: 'in-sync' };
  }

  if (options.write) {
    fs.writeFileSync(file, `${JSON.stringify(upstream, null, 2)}\n`);

    return { ...base, source, status: 'written', changes };
  }

  return { ...base, source, status: 'drifted', changes };
}
