import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { autocatalogDocsRoutes } from '../src/routes';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-routes-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function patterns(): string[] {
  const injected: string[] = [];
  const setup = autocatalogDocsRoutes(root).hooks['astro:config:setup'];
  // SAFETY: the hook reads only config.root, config.srcDir, injectRoute and
  // updateConfig, all supplied here; the rest of Astro's context is never touched.
  setup?.({
    config: { root: pathToFileURL(`${root}/`), srcDir: pathToFileURL(`${root}/src/`) },
    injectRoute: ({ pattern }: { pattern: string }) => injected.push(pattern),
    updateConfig: () => undefined,
  } as never);

  return injected;
}

it('publishes a home page when the site has none', async () => {
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });

  expect(patterns()).toContain('/');
});

it('leaves / alone when the site wrote its own front door', async () => {
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/index.astro'), '<p>ours</p>');

  expect(patterns()).not.toContain('/');
  expect(patterns()).toContain('/catalog');
});

it('publishes a page for each event and earlier version, its schema, each service, each owner and the field index', async () => {
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });

  expect(patterns()).toEqual(
    expect.arrayContaining([
      '/events/[repository]/[domain]/[id]',
      '/events/[repository]/[domain]/[id]/schema.json',
      '/events/[repository]/[domain]/[id]/v/[version]',
      '/events/[repository]/[domain]/[id]/v/[version]/schema.json',
      '/services/[name]',
      '/fields',
      '/owners',
      '/owners/[owner]',
      '/[...slug].md',
      '/llms.txt',
    ]),
  );
});
