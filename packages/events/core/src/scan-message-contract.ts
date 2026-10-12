import { type Dirent, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAdapterEventMeta } from './adapter-event';
import type { AdapterEvent, AdapterEventMeta, ProvenanceValue } from './adapter-event';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  DiscoveryOutput,
  ScanFindingBase,
} from './merge-discoveries';
import { domainForJsonPath, idFromFilename } from './scan-json-schema';
import { DEFAULT_SCAN_EXCLUDE, pascalCase } from './utils';

/**
 * autotel-message-contract approved files.
 *
 * `messageContract({ snapshot: 'OrderPlaced' })...thenContractIsUnchanged()`
 * writes the serialized message, exactly as the serializer produced it and with
 * no header, to `__contracts__/OrderPlaced.approved.txt` beside the test. The
 * file is a sample, not a schema: the payload shape is inferred from it, and
 * says so. Older versions kept for compatibility replay are named by
 * convention (`OrderPlaced_v1`), which is the only version the file can carry.
 */
export interface ScanMessageContractOptions {
  root: string;
  exclude?: string[];
  outDir?: string;
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface MessageContractScanFinding extends ScanFindingBase {
  kind: 'message-contract';
  source: 'message-contract';
}

const CONTRACTS_DIR = '__contracts__';

const APPROVED = /^(.+)\.approved\.txt$/;

/** `OrderPlaced_v2`, `OrderPlaced-v2`, `OrderPlaced.v2`: a pinned major version. */
const VERSIONED = /^(.+?)[._-]v(\d+)$/i;

/**
 * The narrowest JSON Schema one sample proves. Nothing is `required`: one
 * message shows a field present, not that every message carries it, and adding
 * a field is how these contracts are meant to evolve. Removing or renaming one
 * still reads as breaking. A number is `number` (one integer sample does not
 * rule out 4.5), and a null says the field is written, not what it holds.
 */
export function inferJsonSchema(value: JsonValue): JsonObject {
  if (value === null) return {};

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array' };
    const items = value.map(inferJsonSchema);
    const first = JSON.stringify(items[0]);

    return {
      type: 'array',
      items: items.every((item) => JSON.stringify(item) === first) ? items[0]! : {},
    };
  }

  if (isJsonObject(value)) {
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value).map(([key, field]) => [key, inferJsonSchema(field)]),
      ),
    };
  }

  if (value === true || value === false) return { type: 'boolean' };

  return { type: Number.isFinite(value) ? 'number' : 'string' };
}

/**
 * Whether a repository holds any approved message contract, found the way
 * discovery finds them: regular files in a `__contracts__` directory, outside
 * excluded and dot-folders. Stops at the first.
 */
export function hasMessageContracts(root: string): boolean {
  const exclude = new Set(DEFAULT_SCAN_EXCLUDE);

  const walk = (dir: string): boolean => {
    let entries: Dirent[];

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    return entries.some((entry) =>
      entry.isDirectory()
        ? !exclude.has(entry.name) &&
          !entry.name.startsWith('.') &&
          walk(path.join(dir, entry.name))
        : entry.isFile() && path.basename(dir) === CONTRACTS_DIR && APPROVED.test(entry.name),
    );
  };

  return walk(root);
}

async function walkApprovedFiles(
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
      } else if (
        entry.isFile() &&
        path.basename(dir) === CONTRACTS_DIR &&
        APPROVED.test(entry.name)
      ) {
        results.push(full);

        if (results.length > maxFiles) {
          throw new Error(`message contract file limit exceeded (${maxFiles})`);
        }
      }
    }
  }

  await walk(root);

  return results.sort();
}

/**
 * `OrderPlaced.approved.autocatalog.json`: what the approved bytes cannot say.
 * Only a missing sidecar means none. One that does not read throws: dropping it
 * would publish the event without its owners, consumers and version.
 */
async function loadSidecarMeta(file: string): Promise<AdapterEventMeta | undefined> {
  const sidecar = file.replace(/\.txt$/, '.autocatalog.json');
  let stat;

  try {
    stat = await fs.lstat(sidecar);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return undefined;
    throw err;
  }

  // A symlink could name any file on this machine; only the repository's own files are read.
  if (!stat.isFile()) throw new Error('sidecar is not a regular file');
  const raw: JsonValue = JSON.parse(await fs.readFile(sidecar, 'utf8'));

  if (!isJsonObject(raw)) throw new Error('sidecar is not a JSON object');

  return parseAdapterEventMeta(raw);
}

interface Approved {
  relFile: string;
  name: string;
  major?: number;
  sample: JsonValue;
}

async function eventFromApproved(
  approved: Approved,
  file: string,
): Promise<DiscoveryCandidate<MessageContractScanFinding>> {
  const { relFile, name, major, sample } = approved;
  const meta = await loadSidecarMeta(file);
  const id = meta?.id ?? idFromFilename(name);
  const version = meta?.version ?? (major === undefined ? '0.1.0' : `${major}.0.0`);

  // `__contracts__` is where the tool files it, not what a team owns.
  const domain =
    meta?.domain ?? domainForJsonPath(relFile.replace(`${CONTRACTS_DIR}/`, ''), id).domain;

  const from = (declared: string | undefined, fallback: ProvenanceValue = 'inferred') =>
    declared === undefined ? fallback : 'declared';

  const needsReview = !meta?.id || !meta?.version;

  const event: AdapterEvent = {
    id,
    version,
    name: meta?.name ?? name,
    summary:
      meta?.summary ??
      `Inferred from the approved message contract ${relFile} — review before trusting.`,
    domain,
    folderName: pascalCase(id),
    schema: inferJsonSchema(sample),
    // The approved bytes are a real message, so they are the first example.
    examples: [{ name: 'approved', data: sample }],
    meta,
    source: { type: 'code', file: relFile, symbol: name, line: 1 },
    provenance: {
      // A payload shape read off one sample: any written schema beats it.
      default: 'inferred',
      fields: {
        id: from(meta?.id),
        version: from(meta?.version, major === undefined ? 'inferred' : 'extracted'),
        domain: from(meta?.domain),
        summary: from(meta?.summary),
        schema: 'inferred',
        examples: 'extracted',
      },
    },
    // Below every written schema, even one with a guessed domain (0.3): one
    // sample shows a shape, a schema states it.
    confidence: 0.25,
    needsReview,
  };

  return {
    event,
    finding: {
      file: relFile,
      symbol: name,
      line: 1,
      kind: 'message-contract',
      id,
      needsReview,
      source: 'message-contract',
    },
  };
}

/**
 * Discover autotel-message-contract approved files (`__contracts__/*.approved.txt`)
 * and map them to AdapterEvents. Passive: reads committed files, never runs the
 * tests that wrote them and never needs autotel installed.
 *
 * The whole tree is walked, because the files sit beside their tests. That is
 * safe where a scan for `.json` would not be: the directory and suffix are the
 * tool's own, so only files someone approved as a message contract match.
 */
export async function discoverMessageContracts(
  opts: ScanMessageContractOptions,
): Promise<DiscoveryOutput & { skipped: string[] }> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_SCAN_EXCLUDE, ...(opts.exclude ?? [])]);
  const outAbs = opts.outDir ? path.resolve(opts.outDir) : undefined;
  const files = await walkApprovedFiles(root, exclude, outAbs, opts.signal, opts.maxFiles);
  const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

  const errors: string[] = [];
  const skipped: string[] = [];
  // Per directory and message: the current snapshot and the pinned versions beside it.
  const byMessage = new Map<string, Array<Approved & { file: string }>>();

  for (const file of files) {
    opts.signal?.throwIfAborted();
    const relFile = path.relative(root, file).split(path.sep).join('/');
    const stem = APPROVED.exec(path.basename(file))![1]!;
    const versioned = VERSIONED.exec(stem);
    const name = versioned ? versioned[1]! : stem;
    let text: string;

    try {
      if ((await fs.stat(file)).size > maxFileBytes) {
        errors.push(`${relFile}: file exceeds ${maxFileBytes} bytes`);
        continue;
      }

      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    let sample: JsonValue;

    try {
      sample = JSON.parse(text);
    } catch {
      skipped.push(
        `${relFile}: not JSON (a custom serializer?), so its payload shape cannot be read; declare the event with a JSON Schema`,
      );
      continue;
    }

    const key = `${path.dirname(relFile)}/${name}`;
    const group = byMessage.get(key) ?? [];
    group.push({
      file,
      relFile,
      name,
      major: versioned ? Number(versioned[2]) : undefined,
      sample,
    });
    byMessage.set(key, group);
  }

  const candidates: DiscoveryCandidate[] = [];

  for (const group of byMessage.values()) {
    // The unversioned snapshot is what today's test pins; otherwise the highest.
    const rank = (a: Approved) => a.major ?? Number.POSITIVE_INFINITY;
    const [current, ...older] = group.sort((a, b) => rank(b) - rank(a));
    let candidate;

    try {
      candidate = await eventFromApproved(current!, current!.file);
    } catch (err) {
      const sidecar = current!.relFile.replace(/\.txt$/, '.autocatalog.json');
      errors.push(`${sidecar}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    candidates.push(candidate);

    for (const pinned of older) {
      skipped.push(
        `${pinned.relFile}: an earlier version of ${candidate.event.id}, kept for compatibility checks; ${current!.relFile} is cataloged`,
      );
    }
  }

  return {
    candidates,
    events: candidates.map((candidate) => candidate.event),
    findings: candidates.map((candidate) => candidate.finding),
    errors,
    skipped: skipped.sort(),
  };
}

export const messageContractDiscoveryAdapter: DiscoveryAdapter = {
  name: 'message-contract',
  discover: ({ root, exclude, outDir, signal, limits }) =>
    discoverMessageContracts({
      root,
      exclude,
      outDir,
      signal,
      maxFiles: limits?.maxFiles,
      maxFileBytes: limits?.maxFileBytes,
    }),
};
