import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AdapterEvent } from './adapter-event';
import { acquireCatalogPublicationLock } from './catalog-lock';
import {
  AUTOCATALOG_ARTIFACT_FILE,
  AUTOCATALOG_ARTIFACT_SPEC,
  hashTree,
  sha256,
  type ArtifactRepository,
  type CatalogArtifact,
  type CatalogArtifactEntry,
} from './catalog-artifact';
import { discoverEventFolders } from './discover';
import { validateCatalog } from './validate';
import { writeEventFolder } from './write-event-folder';

export interface PublishCatalogOptions {
  outRoot: string;
  events: AdapterEvent[];
  repository?: ArtifactRepository;
  history?: Array<{ event: AdapterEvent; parentFolderName: string }>;
  historyOwnership?: 'preserve' | 'replace';
  narratives?: Array<{ domain: string; folderName: string; version?: string; body: string }>;
}

export interface PublishCatalogResult {
  eventsWritten: number;
  eventsRemoved: string[];
  artifactPath: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);

    return true;
  } catch {
    return false;
  }
}

async function preserveAuthoredOverlay(
  source: string,
  destination: string,
  preserveHistory: boolean,
): Promise<void> {
  const index = path.join(source, 'index.mdx');

  if (await exists(index)) {
    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(index, path.join(destination, 'index.mdx'));
  }

  const versioned = path.join(source, 'versioned');

  if (preserveHistory && (await exists(versioned))) {
    await fs.mkdir(destination, { recursive: true });
    await fs.cp(versioned, path.join(destination, 'versioned'), { recursive: true });
  }
}

async function syncPath(target: string): Promise<void> {
  const handle = await fs.open(target, 'r').catch(() => undefined);

  if (!handle) return;

  try {
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      // Flushing is best effort and platform dependent. Windows rejects fsync on
      // a directory handle with EPERM, and syncPath is called on the stage and
      // parent directories; the rename itself is still atomic there.
      if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EPERM'].includes(error.code ?? '')) throw error;
    });
  } finally {
    await handle.close();
  }
}

/**
 * Publish one complete producer-owned artifact. The staged tree is validated
 * before a rename makes it visible, so consumers never observe a partial scan.
 */
export async function publishCatalog(opts: PublishCatalogOptions): Promise<PublishCatalogResult> {
  const outRoot = path.resolve(opts.outRoot);
  const parent = path.dirname(outRoot);
  await fs.mkdir(parent, { recursive: true });
  const lock = await acquireCatalogPublicationLock(outRoot);
  let stage = '';
  let backup = '';
  let oldMoved = false;

  try {
    stage = await fs.mkdtemp(path.join(parent, `.${path.basename(outRoot)}-stage-`));
    backup = path.join(parent, `.${path.basename(outRoot)}-backup-${randomUUID()}`);
    await lock.update({ stage, backup });
    const paths = new Set<string>();
    const portablePaths = new Set<string>();

    for (const event of opts.events) {
      const relative = path.join(event.domain, event.folderName);
      const portable = relative.normalize('NFC').toLocaleLowerCase('en-US');

      if (paths.has(relative) || portablePaths.has(portable)) {
        throw new Error(`Multiple or case-colliding events publish to ${relative}`);
      }

      paths.add(relative);
      portablePaths.add(portable);
      await writeEventFolder({ outRoot: stage, event });
      await preserveAuthoredOverlay(
        path.join(outRoot, relative),
        path.join(stage, relative),
        opts.historyOwnership !== 'replace',
      );
    }

    for (const historical of opts.history ?? []) {
      await writeEventFolder({
        outRoot: stage,
        event: historical.event,
        folderSegments: [
          historical.event.domain,
          historical.parentFolderName,
          'versioned',
          historical.event.version,
        ],
      });
    }

    for (const narrative of opts.narratives ?? []) {
      const match = narrative.version
        ? (opts.history ?? []).some(
            (historical) =>
              historical.event.domain === narrative.domain &&
              historical.parentFolderName === narrative.folderName &&
              historical.event.version === narrative.version,
          )
        : opts.events.some(
            (event) =>
              event.domain === narrative.domain && event.folderName === narrative.folderName,
          );

      if (!match) {
        throw new Error(
          `Narrative has no published Event: ${narrative.domain}/${narrative.folderName}`,
        );
      }

      await fs.writeFile(
        path.join(
          stage,
          narrative.domain,
          narrative.folderName,
          ...(narrative.version ? ['versioned', narrative.version] : []),
          'index.mdx',
        ),
        narrative.body,
      );
    }

    const existingFolders = await discoverEventFolders(outRoot);
    const removed: string[] = [];

    for (const folder of existingFolders.filter((candidate) => !candidate.isVersioned)) {
      const relative = path.relative(outRoot, folder.path);

      if (paths.has(relative)) continue;

      const hasAuthoredContent =
        (await exists(path.join(folder.path, 'index.mdx'))) ||
        (await exists(path.join(folder.path, 'versioned')));

      if (hasAuthoredContent) {
        throw new Error(
          `Refusing to retire ${relative}: it contains authored index.mdx or versioned history. Move or remove that content explicitly.`,
        );
      }

      removed.push(relative.split(path.sep).join('/'));
    }

    const validation = await validateCatalog(stage);

    if (validation.errors.length > 0) {
      throw new Error(
        `Generated catalog failed validation: ${validation.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const entries: CatalogArtifactEntry[] = [];

    for (const loaded of [...validation.events].sort((a, b) =>
      a.folder.path.localeCompare(b.folder.path),
    )) {
      const relative = path.relative(stage, loaded.folder.path);
      const manifest = await fs.readFile(path.join(loaded.folder.path, 'autocatalog.json'), 'utf8');
      const schema = await fs.readFile(loaded.schemaPath, 'utf8');
      entries.push({
        id: loaded.frontmatter.id,
        version: loaded.frontmatter.version,
        domain: loaded.frontmatter.domain,
        path: relative.split(path.sep).join('/'),
        manifestSha256: sha256(manifest),
        schemaSha256: sha256(schema),
        contentSha256: await hashTree(loaded.folder.path),
      });
    }

    const artifact: CatalogArtifact = {
      spec: AUTOCATALOG_ARTIFACT_SPEC,
      repository: opts.repository,
      validation: { status: 'valid', diagnostics: [] },
      events: entries,
    };

    await fs.writeFile(
      path.join(stage, AUTOCATALOG_ARTIFACT_FILE),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    await syncPath(path.join(stage, AUTOCATALOG_ARTIFACT_FILE));
    await syncPath(stage);

    if (await exists(outRoot)) {
      await fs.rename(outRoot, backup);
      oldMoved = true;
    }

    await fs.rename(stage, outRoot);
    await syncPath(parent);

    if (oldMoved) await fs.rm(backup, { recursive: true, force: true });

    return {
      eventsWritten: opts.events.length,
      eventsRemoved: removed,
      artifactPath: path.join(outRoot, AUTOCATALOG_ARTIFACT_FILE),
    };
  } catch (error) {
    if (oldMoved && !(await exists(outRoot)) && (await exists(backup))) {
      await fs.rename(backup, outRoot);
    }

    if (stage) await fs.rm(stage, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.release();
  }
}
