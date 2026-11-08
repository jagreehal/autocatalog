import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'devalue';
import { afterEach, expect, it, vi } from 'vitest';
import { buildSiteCatalog } from '../src/catalog';
import { docsSiteConfig } from '../src/config';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('serves the catalog a server build carries, with no repositories on disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-snapshot-'));

  await fs.mkdir(path.join(root, 'help/docs'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'help/docs/paid.md'),
    '---\ntitle: Get paid\nowner: support\naccess: [payments]\n---\n',
  );

  const built = await buildSiteCatalog({ ...docsSiteConfig(), root });

  await fs.rm(root, { recursive: true, force: true });

  vi.stubEnv('AUTOCATALOG_CATALOG', stringify(built));
  vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);

  const { docsCatalog } = await import('../src/catalog');
  const served = await docsCatalog();

  expect(served.docs.map((doc) => [doc.id, doc.data.access])).toEqual([
    ['help/paid', ['payments']],
  ]);
});

it('lists only what a signed-out reader may open outside a request, and the reader’s own inside one', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-view-'));

  try {
    await fs.mkdir(path.join(root, 'help/docs'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'help/docs/open.md'),
      '---\ntitle: Open\nowner: support\n---\n',
    );
    await fs.writeFile(
      path.join(root, 'help/docs/paid.md'),
      '---\ntitle: Get paid\nowner: support\naccess: [payments]\n---\n',
    );

    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);
    vi.stubEnv('AUTOCATALOG_SITE_ACCESS', JSON.stringify({ module: 'site/access.ts' }));
    vi.stubEnv('AUTOCATALOG_DOCS_OPEN', JSON.stringify(['help/open']));

    const { docsCatalog } = await import('../src/catalog');
    const { readerView } = await import('../src/reader-view');

    const shared = await docsCatalog();

    const documents = (graph: typeof shared.graph) =>
      graph.resources.flatMap(({ ref }) => (ref.kind === 'document' ? [ref.id] : []));

    expect(shared.docs.map((doc) => doc.id)).toEqual(['help/open']);
    expect(documents(shared.graph)).toEqual(['open']);

    const own = await readerView.run(
      () => true,
      () => docsCatalog(),
    );

    expect(own.docs.map((doc) => doc.id).sort()).toEqual(['help/open', 'help/paid']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('builds the catalog again after a build that failed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-retry-'));

  try {
    const notAFolder = path.join(root, 'file');

    await fs.writeFile(notAFolder, '');
    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', notAFolder);

    const { fullCatalog } = await import('../src/catalog');

    await expect(fullCatalog()).rejects.toThrow('ENOTDIR');

    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);

    await expect(fullCatalog()).resolves.toMatchObject({ docs: [] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
