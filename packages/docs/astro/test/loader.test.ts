import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LoaderContext } from 'astro/loaders';
import { resolveDocsLayout } from 'autocatalog-docs-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { docsLoader } from '../src/loader';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-loader-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('loads nothing when every repository with documents is excluded', async () => {
  // The root is the one repository, and it is excluded.
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs/bad.md'), '---\ntitle: No owner\n---\n');

  const layout = resolveDocsLayout(root, { exclude: [path.basename(root)] });
  const clear = vi.fn<() => void>();

  const meta = new Map<string, string>();

  // Only the store and meta: the glob loader, which needs the rest, must not run.
  const context: Pick<LoaderContext, 'meta'> & { store: Pick<LoaderContext['store'], 'clear'> } = {
    store: { clear },
    meta: {
      get: (key) => meta.get(key),
      set: (key, value) => void meta.set(key, value),
      has: (key) => meta.has(key),
      delete: (key) => void meta.delete(key),
    },
  };

  // SAFETY: with nothing to load, the loader reads only the store and meta given here.
  await docsLoader(layout).load(context as LoaderContext);

  expect(clear).toHaveBeenCalled();
});
