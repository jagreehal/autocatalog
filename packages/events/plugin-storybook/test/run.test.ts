import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from 'autocatalog-core';
import { runFromStorybook, storybookComponents } from '../src';

const FILE = 'autocatalog.components.json';

let root: string;

let build: string;

const index = {
  entries: {
    'ui-banner--short': {
      type: 'story',
      id: 'ui-banner--short',
      name: 'Short',
      title: 'UI/Banner',
    },
  },
};

const read = async () => JSON.parse(await fs.readFile(path.join(root, FILE), 'utf8'));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-components-root-'));
  build = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-components-build-'));
  await fs.writeFile(path.join(build, 'index.json'), JSON.stringify(index));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(build, { recursive: true, force: true });
});

describe('ac from-storybook', () => {
  it('says a build has no manifest, and writes its stories', async () => {
    expect(await runFromStorybook({ build, root })).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('componentsManifest'));
    expect((await read()).components[0].stories).toEqual([
      { id: 'ui-banner--short', name: 'Short', link: '?path=/story/ui-banner--short' },
    ]);
  });

  it('keeps the committed address and owner when a rebuild names neither', async () => {
    await runFromStorybook({ build, root, url: 'https://ui.acme.dev/', owner: 'Design' });
    await runFromStorybook({ build, root });

    expect(await read()).toMatchObject({
      viewer: { name: 'Storybook', url: 'https://ui.acme.dev/' },
      owner: 'Design',
    });
  });

  it('passes --check on a fresh file, and fails on a stale or missing one without writing', async () => {
    expect(await runFromStorybook({ build, root, check: true })).toBe(1);
    await expect(fs.access(path.join(root, FILE))).rejects.toThrow();

    await runFromStorybook({ build, root });
    expect(await runFromStorybook({ build, root, check: true })).toBe(0);

    const moved = structuredClone(index);

    moved.entries['ui-banner--short'].name = 'Renamed';
    await fs.writeFile(path.join(build, 'index.json'), JSON.stringify(moved));

    const before = await fs.readFile(path.join(root, FILE), 'utf8');

    expect(await runFromStorybook({ build, root, check: true })).toBe(1);
    expect(await fs.readFile(path.join(root, FILE), 'utf8')).toBe(before);
  });

  it('refuses a Storybook address a link could run', async () => {
    expect(await runFromStorybook({ build, root, url: 'javascript:alert(1)' })).toBe(1);
  });
});

describe('storybookComponents', () => {
  const manifest = {
    components: {
      'transfer-banner': {
        id: 'transfer-banner',
        name: 'Banner',
        path: './src/Banner.stories.tsx',
        description: 'Shown when a transfer fails.',
        import: "import { Banner } from 'app';",
        reactDocgen: {
          definedInFile: '/Users/someone/app/src/Banner.tsx',
          props: {
            message: { required: true, tsType: { name: 'string' }, description: '' },
            onRetry: { required: false, tsType: { name: 'signature', raw: '() => void' } },
          },
        },
        stories: [{ id: 'transfer-banner--short', name: 'Short', snippet: '<Banner />' }],
      },
    },
  };

  it('keeps what a reader needs from the manifest, and nothing about the machine', () => {
    const components = storybookComponents({ index, manifest });

    expect(components).toEqual([
      {
        id: 'transfer-banner',
        name: 'Banner',
        description: 'Shown when a transfer fails.',
        import: "import { Banner } from 'app';",
        source: 'src/Banner.stories.tsx',
        props: [
          { name: 'message', required: true, type: 'string' },
          { name: 'onRetry', required: false, type: '() => void' },
        ],
        stories: [
          {
            id: 'transfer-banner--short',
            name: 'Short',
            link: '?path=/story/transfer-banner--short',
            snippet: '<Banner />',
          },
        ],
      },
    ]);
    expect(JSON.stringify(components)).not.toContain('/Users/');
  });

  it('falls back to the stories in the index, leaving docs entries out', () => {
    const withDocs = {
      entries: {
        ...index.entries,
        'ui-banner--docs': {
          type: 'docs',
          id: 'ui-banner--docs',
          name: 'Docs',
          title: 'UI/Banner',
        },
      },
    };

    expect(storybookComponents({ index: withDocs })[0]!.stories).toHaveLength(1);
  });
});

// Real output of Storybook 10.6.1 with features.experimentalDocgenServer.
const docgenServer = fileURLToPath(new URL('fixtures/docgen-server', import.meta.url));

describe('a manifest that keeps its stories in files of their own', () => {
  it('follows each reference, for the name, import and stories', async () => {
    expect(await runFromStorybook({ build: docgenServer, root })).toBe(0);

    const [banner] = (await read()).components;

    expect(banner).toMatchObject({
      id: 'checkout-errorbanner',
      name: 'ErrorBanner',
      source: 'src/ErrorBanner.stories.tsx',
      import: "import { ErrorBanner } from '@autocatalog-example/storybook-checkout';",
    });
    expect(banner.stories.map(({ name }: { name: string }) => name)).toEqual([
      'Declined',
      'Retryable',
    ]);
    expect(banner.stories[0].snippet).toContain('Your card was declined');
  });

  it('says the build has no props, rather than publishing none in silence', async () => {
    await runFromStorybook({ build: docgenServer, root });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no props'));
  });

  it('refuses a reference that leaves the build', async () => {
    await fs.mkdir(path.join(build, 'manifests'));
    await fs.writeFile(
      path.join(build, 'manifests/components.json'),
      JSON.stringify({
        components: { a: { id: 'a', name: 'a', stories: { $ref: '../../secrets.json#/a' } } },
      }),
    );

    expect(await runFromStorybook({ build, root })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outside the build'));
  });

  it('names a reference it cannot read', async () => {
    await fs.mkdir(path.join(build, 'manifests'));
    await fs.writeFile(
      path.join(build, 'manifests/components.json'),
      JSON.stringify({
        components: { a: { id: 'a', name: 'a', stories: { $ref: '../missing.json#/a' } } },
      }),
    );

    expect(await runFromStorybook({ build, root })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('missing.json'));
  });
});

describe('a manifest that keeps its docgen in a file of its own', () => {
  /** A build as Storybook writes one: `docgen` and `stories` each behind a `$ref`. */
  const buildWith = async (payload: JsonObject) => {
    const services = path.join(build, 'services/core');

    await fs.mkdir(path.join(build, 'manifests'));
    await fs.mkdir(path.join(services, 'docgen'), { recursive: true });
    await fs.mkdir(path.join(services, 'story-docs'), { recursive: true });
    await fs.writeFile(
      path.join(build, 'manifests/components.json'),
      JSON.stringify({
        v: 1,
        components: {
          'ui-banner': {
            id: 'ui-banner',
            name: 'Banner',
            docgen: { $ref: '../services/core/docgen/ui-banner.json#/components/ui-banner' },
            stories: { $ref: '../services/core/story-docs/ui-banner.json#/components/ui-banner' },
          },
        },
      }),
    );
    await fs.writeFile(
      path.join(services, 'docgen/ui-banner.json'),
      JSON.stringify({ components: { 'ui-banner': payload } }),
    );
    await fs.writeFile(
      path.join(services, 'story-docs/ui-banner.json'),
      JSON.stringify({
        components: {
          'ui-banner': {
            id: 'ui-banner',
            name: 'Banner',
            path: './src/Banner.stories.tsx',
            stories: { 'ui-banner--short': { id: 'ui-banner--short', name: 'Short' } },
          },
        },
      }),
    );
  };

  it('publishes the props and description an engine wrote, beside the stories', async () => {
    await buildWith({
      id: 'ui-banner',
      name: 'Banner',
      description: 'Shown when a transfer fails.',
      reactDocgen: {
        props: { message: { required: true, tsType: { name: 'string' }, description: 'Why.' } },
      },
    });

    expect(await runFromStorybook({ build, root })).toBe(0);

    const [banner] = (await read()).components;

    expect(banner.description).toBe('Shown when a transfer fails.');
    expect(banner.props).toEqual([
      { name: 'message', required: true, type: 'string', description: 'Why.' },
    ]);
    expect(banner.stories).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reads the argTypes the renderer wrote when no engine data is there', async () => {
    await buildWith({
      id: 'ui-banner',
      name: 'Banner',
      argTypes: {
        message: {
          name: 'message',
          description: 'Why.',
          type: { name: 'string', required: true },
          table: { type: { summary: 'string' } },
        },
        onRetry: {
          name: 'onRetry',
          type: { name: 'function', required: false },
          table: { type: { summary: '() => void' } },
        },
      },
    });

    await runFromStorybook({ build, root });

    expect((await read()).components[0].props).toEqual([
      { name: 'message', required: true, type: 'string', description: 'Why.' },
      { name: 'onRetry', required: false, type: '() => void' },
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('refuses a docgen reference that leaves the build', async () => {
    await buildWith({ id: 'ui-banner', name: 'Banner' });

    const manifest = path.join(build, 'manifests/components.json');
    const text = await fs.readFile(manifest, 'utf8');

    await fs.writeFile(manifest, text.replace('../services/core/docgen', '../../outside'));

    expect(await runFromStorybook({ build, root })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outside the build'));
  });
});

describe('each docgen engine', () => {
  const manifestWith = (docgen: JsonObject) => ({
    components: { a: { id: 'a', name: 'A', stories: [], ...docgen } },
  });

  const propsOf = (docgen: JsonObject) =>
    storybookComponents({ index, manifest: manifestWith(docgen) })[0]!.props;

  // What react-docgen-typescript returns for examples/components/checkout.
  it('reads react-docgen-typescript', () => {
    expect(
      propsOf({
        reactDocgenTypescript: {
          description: 'Shown when a payment is declined.',
          props: {
            message: {
              name: 'message',
              required: true,
              type: { name: 'string' },
              description: 'What went wrong.',
              defaultValue: null,
              parent: { fileName: '/Users/someone/ErrorBanner.tsx', name: 'ErrorBannerProps' },
            },
          },
        },
      }),
    ).toEqual([
      { name: 'message', required: true, type: 'string', description: 'What went wrong.' },
    ]);
  });

  it('reads the component meta engine', () => {
    expect(
      propsOf({
        reactComponentMeta: {
          props: { busy: { name: 'busy', required: false, type: 'boolean', description: 'Busy.' } },
        },
      }),
    ).toEqual([{ name: 'busy', required: false, type: 'boolean', description: 'Busy.' }]);
  });

  it('takes the description from the engine when the manifest has none', () => {
    const [component] = storybookComponents({
      index,
      manifest: manifestWith({ reactDocgenTypescript: { description: 'From docgen.', props: {} } }),
    });

    expect(component!.description).toBe('From docgen.');
  });
});
