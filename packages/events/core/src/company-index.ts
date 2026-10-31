import fs from 'node:fs/promises';
import path from 'node:path';
import { jsonObjectSchema, jsonValueSchema, type JsonObject } from './json';
import type { ResourceGraph } from './resource-graph';
import { parseResourceGraph } from './resource-store';
import { isRealFileInside } from './utils';

// A site that does not answer in this long is down, not slow.
const FETCH_TIMEOUT_MS = 15_000;

// The site's whole graph; a file far past this is not one.
const MAX_INDEX_BYTES = 50 * 1024 * 1024;

/** The company graph, and when the site published it, when that is known. */
export interface CompanyIndex {
  graph: ResourceGraph;
  publishedAt?: Date;
}

/**
 * When the index was published and how long ago. Every repository's
 * declarations are as current as the site's last build, so the report says
 * which build it read.
 */
export function publishedLine(what: string, source: string, publishedAt?: Date): string {
  if (!publishedAt) return `${what} from ${source}, publish time unknown`;

  const minutes = Math.max(0, Math.round((Date.now() - publishedAt.getTime()) / 60_000));

  const age =
    minutes < 60
      ? `${minutes} minute(s) ago`
      : minutes < 48 * 60
        ? `${Math.round(minutes / 60)} hour(s) ago`
        : `${Math.round(minutes / (24 * 60))} days ago`;

  return `${what} from ${source}, published ${publishedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')} (${age})`;
}

export interface CompanyIndexOptions {
  /** An environment variable holding a token for a private site, sent as a bearer token. */
  tokenEnv?: string;
}

/**
 * The company graph the site publishes at `/catalog.json`, from its URL or a
 * copy on disk. It is another team's data: parsed against the graph contract,
 * and never trusted further than the names and field paths read from it.
 */
export async function readCompanyIndex(
  source: string,
  options: CompanyIndexOptions = {},
): Promise<CompanyIndex> {
  const remote = /^https?:\/\//i.test(source);

  const { text, publishedAt } = remote
    ? await fetchIndex(source, options)
    : {
        text: await fs.readFile(path.resolve(source), 'utf8'),
        publishedAt: (await fs.stat(path.resolve(source))).mtime,
      };

  if (text.length > MAX_INDEX_BYTES) throw new Error(`${source}: larger than a catalog index`);

  let value;

  try {
    value = jsonValueSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(`${source}: not valid JSON`);
  }

  try {
    return { graph: parseResourceGraph(value), publishedAt };
  } catch (error) {
    throw new Error(
      `${source}: not a resource graph (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

/**
 * One event's JSON Schema, from where the company site serves it beside its
 * graph: `events/<repository>/<domain>/<id>/schema.json`. The names come from
 * another team's graph, so they are encoded into a URL or kept inside the
 * site's folder, never trusted as a path.
 */
export async function readEventSchema(
  index: string,
  event: { repository: string; domain: string; id: string },
  options: CompanyIndexOptions = {},
): Promise<JsonObject> {
  const segments = [event.repository, event.domain, event.id];
  let text: string;

  if (/^https?:\/\//i.test(index)) {
    const url = new URL(
      `events/${segments.map((segment) => encodeURIComponent(segment)).join('/')}/schema.json`,
      index,
    );

    ({ text } = await fetchIndex(url.href, options));
  } else {
    const site = path.dirname(path.resolve(index));
    const file = path.join(site, 'events', ...segments, 'schema.json');

    if (segments.some((segment) => !/^[^/\\]+$/.test(segment) || /^\.\.?$/.test(segment)))
      throw new Error(`${event.repository}/${event.domain}/${event.id}: not a published event`);

    if (!isRealFileInside(site, file)) throw new Error(`${file}: not inside ${site}`);

    text = await fs.readFile(file, 'utf8');
  }

  return jsonObjectSchema.parse(JSON.parse(text));
}

/** A fetched file, and when the server last changed it, when it says. */
interface FetchedIndex {
  text: string;
  publishedAt?: Date;
}

async function fetchIndex(url: string, options: CompanyIndexOptions): Promise<FetchedIndex> {
  const token = options.tokenEnv ? process.env[options.tokenEnv] : undefined;

  if (options.tokenEnv && !token) throw new Error(`${options.tokenEnv} is not set`);

  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);

  const modified = new Date(response.headers.get('last-modified') ?? '');
  const fetched: FetchedIndex = { text: await response.text() };

  if (!Number.isNaN(modified.getTime())) fetched.publishedAt = modified;

  return fetched;
}
