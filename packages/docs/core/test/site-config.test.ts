import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDocs } from '../src/check';
import { readDocs, repositoryMetas } from '../src/read-docs';

import { readSiteConfig } from '../src/site-config';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-site-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

describe('docs/meta.json', () => {
  const meta = JSON.stringify({
    label: 'Payments',
    description: 'How money moves.',
    owner: 'payments-team',
    sidebar: [{ directory: 'guide', label: 'Start here', collapsed: true }],
  });

  it('names a repository in its own words', async () => {
    await write('payments/docs/meta.json', meta);
    await write('payments/docs/index.md', '---\ntitle: Payments\nowner: x\n---\n');
    await write('payments/docs/guide/start.md', '---\ntitle: Start\nowner: x\n---\n');

    expect(repositoryMetas(root).get('payments')).toEqual(JSON.parse(meta));
  });

  it('owns every page that names no owner, and a page can name its own', async () => {
    await write('payments/docs/meta.json', JSON.stringify({ owner: 'payments-team' }));
    await write('payments/docs/one.md', '---\ntitle: One\n---\n');
    await write('payments/docs/two.md', '---\ntitle: Two\nowner: treasury\n---\n');

    expect(readDocs(root).map(({ data }) => data.owner)).toEqual(['payments-team', 'treasury']);
    expect(checkDocs(root).failures).toEqual([]);
  });

  it('fails the check on a file that does not parse, naming it', async () => {
    await write('payments/docs/meta.json', '{ "lable": "Typo" }');
    await write('payments/docs/one.md', '---\ntitle: One\nowner: x\n---\n');

    expect(checkDocs(root).failures.join('\n')).toMatch(/payments\/docs\/meta\.json.*lable/);
  });

  it.each(['one.md', 'ops/nope', '../outside', '.'])(
    'fails the check on a sidebar entry the navigation could not show: %s',
    async (directory) => {
      await write(
        'payments/docs/meta.json',
        JSON.stringify({ sidebar: [{ directory, label: 'Lost' }] }),
      );
      await write('payments/docs/one.md', '---\ntitle: One\nowner: x\n---\n');
      await write('payments/docs/ops/runbooks/two.md', '---\ntitle: Two\nowner: x\n---\n');
      await write('payments/outside/three.md', 'x');

      expect(checkDocs(root).failures.join('\n')).toContain(`"${directory}"`);
    },
  );

  it('fails the check on a sidebar folder that is not there', async () => {
    await write('payments/docs/meta.json', meta);
    await write('payments/docs/one.md', '---\ntitle: One\n---\n');

    expect(checkDocs(root).failures.join('\n')).toMatch(/meta\.json.*"guide"/);
  });
});

describe('autocatalog.site.json', () => {
  it("resolves the assistant's module and icon files beside it, and keeps a URL", async () => {
    await write(
      'autocatalog.site.json',
      JSON.stringify({
        chat: {
          module: './site/chat.ts',
          title: 'Ask',
          icons: { launcher: './brand/chat.svg', send: '/send.svg', close: '<svg/>' },
        },
      }),
    );

    expect(readSiteConfig(root).chat).toEqual({
      module: path.join(root, 'site/chat.ts'),
      title: 'Ask',
      icons: {
        launcher: pathToFileURL(path.join(root, 'brand/chat.svg')).href,
        send: '/send.svg',
        close: '<svg/>',
      },
    });
  });

  it('resolves the access module beside it', async () => {
    await write(
      'autocatalog.site.json',
      JSON.stringify({
        output: 'server',
        access: { module: './site/access.ts', denied: 'teaser' },
      }),
    );

    expect(readSiteConfig(root).access).toEqual({
      module: path.join(root, 'site/access.ts'),
      denied: 'teaser',
    });
  });

  it('finds nothing to read in a project without one', () => {
    expect(readSiteConfig(root)).toEqual({});
  });

  it('reads the site and resolves its brand folder against the file', async () => {
    await write(
      'autocatalog.site.json',
      JSON.stringify({ title: 'Acme Docs', theme: 'teal', brand: './brand' }),
    );

    expect(readSiteConfig(root)).toEqual({
      title: 'Acme Docs',
      theme: 'teal',
      brand: path.join(root, 'brand'),
    });
  });

  it('takes extensions as a path against the file or a package by name, and server output', async () => {
    await write(
      'autocatalog.site.json',
      JSON.stringify({ extend: ['./site/extend.ts', '@acme/site-kit'], output: 'server' }),
    );

    expect(readSiteConfig(root)).toEqual({
      extend: [path.join(root, 'site/extend.ts'), '@acme/site-kit'],
      output: 'server',
    });
  });

  it('takes header links, head tags and the interface in its own words', async () => {
    const site = {
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/acme' }],
      head: [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } }],
      strings: { 'search.label': 'Search help' },
    };

    await write('autocatalog.site.json', JSON.stringify(site));

    expect(readSiteConfig(root)).toEqual(site);
  });

  it('takes header links, each standing for the paths it matches', async () => {
    const nav = [
      { label: 'Guides', href: '/', match: ['/labels/', '/publishers/'] },
      { label: 'Status', href: 'https://status.acme.com' },
    ];

    await write('autocatalog.site.json', JSON.stringify({ nav }));

    expect(readSiteConfig(root)).toEqual({ nav });
  });

  it('refuses a header link without a label', async () => {
    await write('autocatalog.site.json', JSON.stringify({ nav: [{ href: '/' }] }));

    expect(() => readSiteConfig(root)).toThrow('label');
  });

  it('refuses a head tag a page cannot hold', async () => {
    await write('autocatalog.site.json', JSON.stringify({ head: [{ tag: 'div' }] }));

    expect(() => readSiteConfig(root)).toThrow('autocatalog.site.json');
  });

  it('names what the site enrols', async () => {
    await write('autocatalog.site.json', JSON.stringify({ topic: 'catalog', owner: 'acme' }));

    expect(readSiteConfig(root)).toEqual({ topic: 'catalog', owner: 'acme' });
  });

  it('reads a page named on its own the way it reads one renamed', async () => {
    await write(
      'autocatalog.site.json',
      JSON.stringify({ navigation: { groups: [{ label: 'Browse', items: ['owners'] }] } }),
    );

    expect(readSiteConfig(root).navigation?.groups[0]?.items).toEqual([{ id: 'owners' }]);
  });

  it('refuses a theme it does not have, and a field it does not know', async () => {
    await write('autocatalog.site.json', JSON.stringify({ theme: 'mauve' }));
    expect(() => readSiteConfig(root)).toThrow(/autocatalog\.site\.json.*theme/s);

    await write('autocatalog.site.json', JSON.stringify({ titel: 'x' }));
    expect(() => readSiteConfig(root)).toThrow(/titel/);
  });
});
