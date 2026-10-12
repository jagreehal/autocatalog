import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const lockRecordSchema = z.object({
  token: z.string(),
  pid: z.number(),
  hostname: z.string(),
  startedAt: z.string(),
  stage: z.string().optional(),
  backup: z.string().optional(),
  outRoot: z.string(),
});

type LockRecord = z.infer<typeof lockRecordSchema>;

export class CatalogPublicationLockedError extends Error {
  readonly code = 'catalog_publication_locked';
  constructor(public readonly lockPath: string) {
    super(`Catalog publication is already active: ${lockPath}`);
    this.name = 'CatalogPublicationLockedError';
  }
}

export function catalogPublicationLockPath(outRoot: string): string {
  const absolute = path.resolve(outRoot);

  return path.join(path.dirname(absolute), `.${path.basename(absolute)}-publish.lock`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);

    return true;
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function readRecord(lockPath: string): Promise<LockRecord | undefined> {
  try {
    return lockRecordSchema.parse(JSON.parse(await fs.readFile(lockPath, 'utf8')));
  } catch {
    return undefined;
  }
}

async function recoverAbandonedPublication(record: LockRecord): Promise<void> {
  if (record.hostname !== os.hostname() || processIsAlive(record.pid)) {
    throw new CatalogPublicationLockedError(catalogPublicationLockPath(record.outRoot));
  }

  if (!(await exists(record.outRoot)) && record.backup && (await exists(record.backup))) {
    await fs.rename(record.backup, record.outRoot);
  } else if (record.backup && (await exists(record.backup))) {
    await fs.rm(record.backup, { recursive: true, force: true });
  }

  if (record.stage && (await exists(record.stage))) {
    await fs.rm(record.stage, { recursive: true, force: true });
  }
}

export interface HeldCatalogLock {
  update(state: Pick<LockRecord, 'stage' | 'backup'>): Promise<void>;
  release(): Promise<void>;
}

export async function acquireCatalogPublicationLock(outRoot: string): Promise<HeldCatalogLock> {
  const absolute = path.resolve(outRoot);
  const lockPath = catalogPublicationLockPath(absolute);
  const token = randomUUID();

  const record: LockRecord = {
    token,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    outRoot: absolute,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.sync();
      await handle.close();

      return {
        async update(state) {
          Object.assign(record, state);
          const current = await readRecord(lockPath);

          if (current?.token !== token) throw new CatalogPublicationLockedError(lockPath);
          const handle = await fs.open(lockPath, 'w', 0o600);
          await handle.writeFile(`${JSON.stringify(record)}\n`);
          await handle.sync();
          await handle.close();
        },
        async release() {
          const current = await readRecord(lockPath);

          if (current?.token === token) await fs.unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const existing = await readRecord(lockPath);

      if (!existing) throw new CatalogPublicationLockedError(lockPath);
      await recoverAbandonedPublication(existing);
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  throw new CatalogPublicationLockedError(lockPath);
}

/** Readers wait for the transactional swap so they observe old or new, never its rename gap. */
export async function waitForCatalogPublication(outRoot: string, timeoutMs = 5_000): Promise<void> {
  const lockPath = catalogPublicationLockPath(outRoot);
  const deadline = Date.now() + timeoutMs;

  while (await exists(lockPath)) {
    const record = await readRecord(lockPath);

    if (record && record.hostname === os.hostname() && !processIsAlive(record.pid)) {
      await recoverAbandonedPublication(record);
      await fs.unlink(lockPath).catch(() => undefined);

      return;
    }

    if (Date.now() >= deadline) throw new CatalogPublicationLockedError(lockPath);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
