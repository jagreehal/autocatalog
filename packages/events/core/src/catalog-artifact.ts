import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { jsonValueSchema } from './json';
import type { LoadedEvent } from './load';

export const AUTOCATALOG_ARTIFACT_FILE = 'autocatalog.artifact.json';

export const AUTOCATALOG_ARTIFACT_SPEC = 'autocatalog/artifact-v1';

export interface ArtifactRepository {
  id?: string;
  revision?: string;
  requestedRef?: string;
  treeDigest?: string;
  dirty?: boolean;
  url?: string;
}

export interface CatalogArtifactEntry {
  id: string;
  version: string;
  domain: string;
  path: string;
  manifestSha256: string;
  schemaSha256: string;
  contentSha256: string;
}

export interface CatalogArtifact {
  spec: typeof AUTOCATALOG_ARTIFACT_SPEC;
  repository?: ArtifactRepository;
  validation: { status: 'valid'; diagnostics: [] };
  events: CatalogArtifactEntry[];
}

export interface ArtifactIntegrityDiagnostic {
  code: 'artifact_invalid' | 'artifact_integrity_mismatch';
  message: string;
  path: string;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashTree(root: string): Promise<string> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const target = path.join(directory, entry.name);

      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) files.push(target);
      else throw new Error(`Unsupported file type in Catalog artifact: ${target}`);
    }
  }

  await walk(root);
  const hash = createHash('sha256');

  for (const file of files.sort()) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await fs.readFile(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function safeArtifactPath(root: string, relative: string): string | undefined {
  const segments = relative.split('/');

  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return undefined;
  }

  const target = path.resolve(root, relative);

  return target === root || target.startsWith(`${root}${path.sep}`) ? target : undefined;
}

const repositorySchema = z.object({
  id: z.string().optional(),
  revision: z.string().optional(),
  requestedRef: z.string().optional(),
  treeDigest: z.string().optional(),
  dirty: z.boolean().optional(),
  url: z.string().optional(),
}) satisfies z.ZodType<ArtifactRepository>;

// Entries are checked one at a time below, so one malformed entry is reported
// on its own instead of rejecting the whole artifact.
const artifactSchema = z.object({
  spec: z.literal(AUTOCATALOG_ARTIFACT_SPEC),
  validation: z.object({
    status: z.literal('valid'),
    diagnostics: z.array(jsonValueSchema).max(0),
  }),
  events: z.array(jsonValueSchema),
});

const entrySchema = z.object({
  id: z.string(),
  version: z.string(),
  domain: z.string(),
  path: z.string(),
  manifestSha256: z.string(),
  schemaSha256: z.string(),
  contentSha256: z.string(),
}) satisfies z.ZodType<CatalogArtifactEntry>;

/** Verify a producer index against every loaded Event folder and byte on disk. */
export async function verifyCatalogArtifact(
  eventsRoot: string,
  events: LoadedEvent[],
  /** Event folders the read left out on purpose, such as history: not checked, not missing. */
  skipped: ReadonlySet<string> = new Set(),
): Promise<ArtifactIntegrityDiagnostic[]> {
  const root = path.resolve(eventsRoot);
  const artifactPath = path.join(root, AUTOCATALOG_ARTIFACT_FILE);
  let raw: string;

  try {
    raw = await fs.readFile(artifactPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];

    return [{ code: 'artifact_invalid', message: String(error), path: artifactPath }];
  }

  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    return [
      {
        code: 'artifact_invalid',
        message: `Invalid ${AUTOCATALOG_ARTIFACT_FILE}: ${error instanceof Error ? error.message : String(error)}`,
        path: artifactPath,
      },
    ];
  }

  const parsed = artifactSchema.safeParse(json);

  if (!parsed.success) {
    return [
      {
        code: 'artifact_invalid',
        message: `Invalid or unsupported ${AUTOCATALOG_ARTIFACT_FILE}`,
        path: artifactPath,
      },
    ];
  }

  const diagnostics: ArtifactIntegrityDiagnostic[] = [];

  const loadedByPath = new Map(
    events.map((event) => [
      path.relative(root, event.folder.path).split(path.sep).join('/'),
      event,
    ]),
  );

  const indexedPaths = new Set<string>();
  const portablePaths = new Set<string>();

  for (const candidate of parsed.data.events) {
    const checked = entrySchema.safeParse(candidate);

    if (!checked.success) {
      diagnostics.push({
        code: 'artifact_invalid',
        message: 'Malformed artifact event entry',
        path: artifactPath,
      });
      continue;
    }

    const entry = checked.data;
    const folder = safeArtifactPath(root, entry.path);
    const portablePath = entry.path.normalize('NFC').toLocaleLowerCase('en-US');

    if (!folder || indexedPaths.has(entry.path) || portablePaths.has(portablePath)) {
      diagnostics.push({
        code: 'artifact_invalid',
        message: `Unsafe or duplicate artifact event path: ${entry.path}`,
        path: artifactPath,
      });
      continue;
    }

    indexedPaths.add(entry.path);
    portablePaths.add(portablePath);
    const loaded = loadedByPath.get(entry.path);

    if (!loaded && skipped.has(entry.path)) continue;

    if (
      !loaded ||
      loaded.frontmatter.id !== entry.id ||
      loaded.frontmatter.version !== entry.version ||
      loaded.frontmatter.domain !== entry.domain
    ) {
      diagnostics.push({
        code: 'artifact_integrity_mismatch',
        message: `Artifact entry does not match loaded Event: ${entry.path}`,
        path: folder,
      });
      continue;
    }

    const manifest = await fs
      .readFile(path.join(folder, 'autocatalog.json'))
      .catch(() => undefined);

    const schema = await fs.readFile(loaded.schemaPath).catch(() => undefined);
    const contentHash = await hashTree(folder).catch(() => undefined);

    if (
      !manifest ||
      !schema ||
      sha256(manifest) !== entry.manifestSha256 ||
      sha256(schema) !== entry.schemaSha256 ||
      contentHash !== entry.contentSha256
    ) {
      diagnostics.push({
        code: 'artifact_integrity_mismatch',
        message: `Content hash mismatch for ${entry.path}`,
        path: folder,
      });
    }
  }

  for (const relative of loadedByPath.keys()) {
    if (!indexedPaths.has(relative)) {
      diagnostics.push({
        code: 'artifact_integrity_mismatch',
        message: `Loaded Event is missing from the producer index: ${relative}`,
        path: path.join(root, relative),
      });
    }
  }

  return diagnostics;
}

export interface CatalogFreshness {
  /** Revision the catalog was generated from, when the scan recorded one. */
  generatedFrom?: string;
  /** Revision the caller's working tree is on now. */
  currentRevision?: string;
  /** The working tree had uncommitted changes when the catalog was generated. */
  generatedDirty?: boolean;
  /** The working tree has uncommitted changes now. */
  workingTreeDirty?: boolean;
  /** True when the catalog cannot be assumed to describe the current tree. */
  stale: boolean;
  /** Plain-language reason, for an answer an agent repeats to a person. */
  reason: string;
}

/**
 * Whether the catalog still describes the working tree.
 *
 * An agent acting on a catalog generated three commits ago states something
 * false with complete confidence, and nothing in the answer would have told it
 * so. The artifact already records the revision it was built from; this
 * compares that to the tree the caller is actually sitting on.
 */
export async function readCatalogFreshness(
  eventsRoot: string,
  repoRoot: string,
  git: (args: string[], cwd: string) => Promise<string>,
): Promise<CatalogFreshness> {
  let repository: ArtifactRepository | undefined;

  try {
    const raw = await fs.readFile(path.join(eventsRoot, AUTOCATALOG_ARTIFACT_FILE), 'utf8');
    repository = z
      .object({ repository: repositorySchema.optional() })
      .parse(JSON.parse(raw)).repository;
  } catch {
    return {
      stale: true,
      reason: `no ${AUTOCATALOG_ARTIFACT_FILE} — this catalog was not published by a scan, so its age is unknown`,
    };
  }

  // git terminates its output with a newline; comparing it untrimmed to the
  // recorded revision makes every catalog look stale.
  const [currentRevision, status] = await Promise.all([
    git(['rev-parse', 'HEAD'], repoRoot)
      .then((out) => out.trim())
      .catch(() => undefined),
    git(['status', '--porcelain'], repoRoot).catch(() => undefined),
  ]);

  const workingTreeDirty = status === undefined ? undefined : status.trim().length > 0;

  const base = {
    generatedFrom: repository?.revision,
    currentRevision,
    generatedDirty: repository?.dirty,
    workingTreeDirty,
  };

  if (!repository?.revision || !currentRevision) {
    return {
      ...base,
      stale: false,
      reason: 'not a git checkout — freshness cannot be established',
    };
  }

  if (repository.revision !== currentRevision) {
    return {
      ...base,
      stale: true,
      reason: `catalog was generated from ${repository.revision.slice(0, 8)}, the tree is now on ${currentRevision.slice(0, 8)} — re-run \`ac scan\` before trusting it`,
    };
  }

  if (workingTreeDirty) {
    return {
      ...base,
      stale: true,
      reason:
        'the working tree has uncommitted changes since the catalog was generated — it may not describe the code you are reading',
    };
  }

  return {
    ...base,
    stale: false,
    reason: 'catalog matches the current revision with a clean tree',
  };
}
