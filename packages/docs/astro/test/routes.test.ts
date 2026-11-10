import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RESERVED_SEGMENTS } from '../src/kinds';
import { autocatalogDocsRoutes } from '../src/routes';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-routes-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function patterns({
  output = 'static',
  audience,
  perReaderKinds,
}: { output?: string; audience?: string; perReaderKinds?: string[] } = {}): string[] {
  const injected: string[] = [];

  const setup = autocatalogDocsRoutes(root, undefined, audience, perReaderKinds).hooks[
    'astro:config:setup'
  ];

  // SAFETY: the hook reads only config.root, config.srcDir, config.output,
  // injectRoute and updateConfig, all supplied here; the rest of Astro's context is never touched.
  setup?.({
    config: {
      root: pathToFileURL(`${root}/`),
      srcDir: pathToFileURL(`${root}/src/`),
      output,
    },
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

it('publishes pages for events and earlier versions, schemas, services, owners, domains, APIs, data models, and the field and schema indexes', async () => {
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });

  expect(patterns()).toEqual(
    expect.arrayContaining([
      '/events/[repository]/[domain]/[id]',
      '/events/[repository]/[domain]/[id].md',
      '/events/[repository]/[domain]/[id]/schema.json',
      '/events/[repository]/[domain]/[id]/v/[version]',
      '/events/[repository]/[domain]/[id]/v/[version]/schema.json',
      '/services',
      '/services/[name]',
      '/services/[name].md',
      '/fields',
      '/schemas',
      '/apis',
      '/apis/[repository]/[name]',
      '/apis/[repository]/[name]/reference',
      '/apis/[repository]/[name]/openapi.json',
      '/owners',
      '/owners/[owner]',
      '/domains',
      '/domains/[domain]',
      '/data',
      '/data/[repository]/[name]',
      '/data/[repository]/[name].md',
      '/[...slug].md',
      '/llms.txt',
      '/llms-full.txt',
      '/contracts/docs-manifest.json',
    ]),
  );
});

it("keeps a document kind's index from taking the address of a page the site publishes", async () => {
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });

  const segments = patterns().flatMap((pattern) => {
    const first = pattern.split('/')[1] ?? '';

    return first && !first.startsWith('[') && !RESERVED_SEGMENTS.has(first) ? [first] : [];
  });

  // A kind index sits at /<path>/, below every static page in priority.
  expect(patterns()).toContain('/[kind]');
  expect(segments).toEqual([]);
});

it('leaves out whole-document copies on a server site that does not know who reads', () => {
  const copies = ['/[...slug].md', '/llms-full.txt'];

  const unscoped = patterns({ output: 'server' });

  for (const copy of copies) expect(unscoped).not.toContain(copy);
  expect(unscoped).toContain('/llms.txt');
  expect(patterns({ output: 'server', perReaderKinds: ['runbooks'] })).toEqual(
    expect.arrayContaining(copies),
  );
  expect(patterns({ output: 'server', audience: 'public' })).toEqual(
    expect.arrayContaining(copies),
  );
  expect(patterns()).toEqual(expect.arrayContaining(copies));
});

it('keeps each API’s framed reference on a site for readers outside, beside its page', () => {
  expect(patterns({ audience: 'public' })).toEqual(
    expect.arrayContaining([
      '/apis/[repository]/[name]',
      '/apis/[repository]/[name]/reference',
      '/apis/[repository]/[name]/openapi.json',
    ]),
  );
});
