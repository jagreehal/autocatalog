import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_ARTIFACT_FILE,
  readCatalogFreshness,
  type ArtifactRepository,
} from '../src/index';

// The whole value of this signal is that it refuses to say "fine" when it does
// not know, so every branch is worth pinning.
const fakeGit =
  (revision?: string, status = '') =>
  async (args: string[]): Promise<string> => {
    if (args[0] === 'rev-parse') {
      if (!revision) throw new Error('not a git repository');

      return `${revision}\n`;
    }

    return status;
  };

describe('readCatalogFreshness', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-fresh-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const writeArtifact = (repository: ArtifactRepository) =>
    fs.writeFile(
      path.join(root, AUTOCATALOG_ARTIFACT_FILE),
      JSON.stringify({
        spec: 'autocatalog/artifact-v1',
        repository,
        validation: { status: 'valid', diagnostics: [] },
        events: [],
      }),
    );

  it('treats a catalog with no artifact as unknown, which is stale', async () => {
    const result = await readCatalogFreshness(root, root, fakeGit('a'.repeat(40)));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain('not published by a scan');
  });

  it('flags a catalog generated from a different revision', async () => {
    await writeArtifact({ revision: 'a'.repeat(40) });
    const result = await readCatalogFreshness(root, root, fakeGit('b'.repeat(40)));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain('aaaaaaaa');
    expect(result.reason).toContain('bbbbbbbb');
  });

  it('flags a dirty working tree even on the right revision', async () => {
    await writeArtifact({ revision: 'a'.repeat(40) });
    const result = await readCatalogFreshness(root, root, fakeGit('a'.repeat(40), ' M src/x.ts\n'));
    expect(result.stale).toBe(true);
    expect(result.workingTreeDirty).toBe(true);
  });

  it('is fresh on the same revision with a clean tree', async () => {
    await writeArtifact({ revision: 'a'.repeat(40) });
    const result = await readCatalogFreshness(root, root, fakeGit('a'.repeat(40)));
    expect(result.stale).toBe(false);
    expect(result.currentRevision).toBe('a'.repeat(40));
  });

  it('does not claim staleness outside a git checkout', async () => {
    await writeArtifact({});
    const result = await readCatalogFreshness(root, root, fakeGit(undefined));
    expect(result.stale).toBe(false);
    expect(result.reason).toContain('not a git checkout');
  });
});
