import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSiteExtensions, mergeSiteExtensions, siteBundling } from '../src/extensions';

describe('site extensions', () => {
  it('folds extensions in order, local paths against their own folder', () => {
    const plugin = () => () => undefined;

    const merged = mergeSiteExtensions([
      {
        dir: '/a',
        extension: {
          middleware: './auth.ts',
          routeMiddleware: ['./sidebar.ts'],
          components: { Footer: './Footer.astro', Search: 'pkg/Search.astro' },
          rehypePlugins: [plugin],
        },
      },
      { dir: '/b', extension: { components: { Footer: './Other.astro' }, customCss: ['./x.css'] } },
    ]);

    expect(merged.middleware).toEqual(['/a/auth.ts']);
    expect(merged.routeMiddleware).toEqual(['/a/sidebar.ts']);
    expect(merged.components).toEqual({ Footer: '/b/Other.astro', Search: 'pkg/Search.astro' });
    expect(merged.customCss).toEqual(['/b/x.css']);
    expect(merged.rehypePlugins).toEqual([plugin]);
  });

  it('fails two extensions that add a block of the same name, naming both files', () => {
    expect(() =>
      mergeSiteExtensions([
        { dir: '/a', extension: { blocks: { pricing: './Pricing.astro' } } },
        { dir: '/b', extension: { blocks: { pricing: './Plans.astro' } } },
      ]),
    ).toThrow("two extensions add a block named 'pricing': /a/Pricing.astro and /b/Plans.astro");
  });

  it('loads a module exporting an array, and adds middleware through an integration', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ext-'));
    const file = path.join(dir, 'extend.mjs');

    await fs.writeFile(
      file,
      "export default [{ middleware: './one.ts' }, { middleware: './two.ts' }];",
    );

    const ext = await loadSiteExtensions([file]);

    expect(ext.middleware).toEqual([path.join(dir, 'one.ts'), path.join(dir, 'two.ts')]);
    expect(ext.integrations.map((integration) => integration.name)).toEqual([
      'autocatalog-site-middleware',
      'autocatalog-site-resolve',
      'autocatalog-site-dependencies',
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('fails on a field it does not know, naming the module', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ext-'));
    const file = path.join(dir, 'typo.mjs');

    await fs.writeFile(file, "export default { middlewares: './auth.ts' };");

    await expect(loadSiteExtensions([file])).rejects.toThrow('middlewares');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('says which module exports nothing it can use', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ext-'));
    const file = path.join(dir, 'bad.mjs');

    await fs.writeFile(file, 'export const nothing = 1;');

    await expect(loadSiteExtensions([file])).rejects.toThrow(`extend: ${file}`);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('the site’s own dependencies', () => {
  it('stay out of the server bundle, except what renders with React', async () => {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-deps-'));

    try {
      await fs.writeFile(
        path.join(project, 'package.json'),
        JSON.stringify({
          dependencies: {
            autotel: '1.0.0',
            'lucide-react': '1.0.0',
            'autocatalog-cli': '1.0.0',
            react: '18.3.1',
          },
        }),
      );
      await fs.mkdir(path.join(project, 'node_modules/lucide-react'), { recursive: true });
      await fs.writeFile(
        path.join(project, 'node_modules/lucide-react/package.json'),
        JSON.stringify({ peerDependencies: { react: '*' } }),
      );

      expect(siteBundling(project)).toEqual({
        external: ['autotel'],
        noExternal: ['lucide-react'],
      });
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
});
