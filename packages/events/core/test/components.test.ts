import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPONENTS_FILE,
  createComponentResourceGraph,
  findCatalogRoots,
  publishesCatalogContent,
  readComponentsFile,
  writeComponents,
  type JsonValue,
} from '../src';

const repository = async (content?: JsonValue) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-components-'));

  if (content !== undefined)
    await fs.writeFile(path.join(root, COMPONENTS_FILE), JSON.stringify(content));

  return root;
};

const component = (id: string, source: string) => ({
  id,
  name: id,
  source,
  props: [],
  stories: [],
});

describe('createComponentResourceGraph', () => {
  it('is nothing for a repository without the file', async () => {
    expect(await createComponentResourceGraph('app', await repository())).toBeUndefined();
  });

  it('defines each component from its repository, with its viewer', async () => {
    const root = await repository({
      viewer: { name: 'Gallery', url: 'https://gallery.acme.dev/' },
      owner: 'Mobile',
      components: [{ ...component('card', 'src/Card.tsx'), description: 'A card.' }],
    });

    const graph = await createComponentResourceGraph('app', root);
    const resource = graph?.resources.find(({ ref }) => ref.kind === 'component');

    expect(resource).toMatchObject({
      ref: { kind: 'component', namespace: 'app', id: 'card' },
      title: 'card',
      summary: 'A card.',
      url: 'components/app/card/',
      owner: { team: 'Mobile' },
      attributes: { viewer: { name: 'Gallery' }, source: 'src/Card.tsx' },
    });
    expect(graph?.relationships).toEqual([
      expect.objectContaining({
        type: 'defines',
        from: { kind: 'repository', id: 'app' },
        to: resource?.ref,
      }),
    ]);
  });

  it('takes the owner from CODEOWNERS for each component, when the file names none', async () => {
    const root = await repository({
      components: [component('a', 'src/a/A.tsx'), component('b', 'lib/B.tsx')],
    });

    await fs.writeFile(path.join(root, 'CODEOWNERS'), '/src/ @acme/checkout\n');

    const graph = await createComponentResourceGraph('app', root);

    expect(
      graph?.resources.flatMap(({ ref, owner }) =>
        ref.kind === 'component' ? [[ref.id, owner?.team]] : [],
      ),
    ).toEqual([
      ['a', 'acme/checkout'],
      ['b', undefined],
    ]);
  });
});

describe('writeComponents', () => {
  it('sorts, and keeps the committed address and owner when a rewrite names neither', async () => {
    const root = await repository();
    const viewer = { name: 'Gallery', url: 'https://gallery.acme.dev/' };

    await writeComponents(root, { components: [], viewer, owner: 'Mobile' });
    await writeComponents(root, {
      components: [component('b', 'b'), component('a', 'a')],
      viewer: { name: 'Gallery' },
    });

    const file = await readComponentsFile(root);

    expect(file).toMatchObject({ viewer, owner: 'Mobile' });
    expect(file?.components.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('keeps the committed viewer when a rewrite names none', async () => {
    const root = await repository();
    const viewer = { name: 'Gallery', url: 'https://gallery.acme.dev/' };

    await writeComponents(root, { components: [], viewer });
    await writeComponents(root, { components: [component('a', 'a')] });

    expect((await readComponentsFile(root))?.viewer).toEqual(viewer);
  });

  it('leaves the old address behind when the viewer changes', async () => {
    const root = await repository();

    await writeComponents(root, {
      components: [],
      viewer: { name: 'Gallery', url: 'https://gallery.acme.dev/' },
    });
    await writeComponents(root, { components: [], viewer: { name: 'Ladle' } });

    expect((await readComponentsFile(root))?.viewer).toEqual({ name: 'Ladle' });
  });

  it('compares without writing under check', async () => {
    const root = await repository();
    const input = { components: [component('a', 'a')] };

    expect(await writeComponents(root, input, { check: true })).toBe('stale');
    await expect(fs.access(path.join(root, COMPONENTS_FILE))).rejects.toThrow();

    await writeComponents(root, input);
    expect(await writeComponents(root, input, { check: true })).toBe('current');
  });

  it('takes ids in any language', async () => {
    const root = await repository();

    const input = {
      components: [
        {
          ...component('größe', 'a'),
          stories: [{ id: 'größe--standard', name: 'Standard' }],
        },
      ],
    };

    expect(await writeComponents(root, input)).toBe('written');
  });

  it('refuses a viewer address a link could run', async () => {
    const viewer = { name: 'Bad', url: 'javascript:alert(1)' };

    await expect(writeComponents(await repository(), { components: [], viewer })).rejects.toThrow(
      /http or https/,
    );
  });
});

describe('the file', () => {
  it('makes a repository publish to the site', async () => {
    expect(publishesCatalogContent(await repository({ components: [] }))).toBe(true);
  });

  it('makes a package the root of its own site', async () => {
    const root = await repository({ components: [] });

    await fs.writeFile(path.join(root, 'package.json'), '{}');

    expect(findCatalogRoots(root).map(({ dir }) => dir)).toEqual([root]);
  });

  it.each([
    [
      'a component id that climbs out of its page',
      { components: [{ id: '..', name: 'x', props: [], stories: [] }] },
    ],
    [
      'a component id that would take its Markdown twin path',
      { components: [{ id: 'card.md', name: 'x', props: [], stories: [] }] },
    ],
    [
      'a viewer that is not a web address',
      { viewer: { name: 'x', url: 'javascript:alert(1)' }, components: [] },
    ],
  ])('refuses %s', async (_, content) => {
    await expect(readComponentsFile(await repository(content))).rejects.toThrow(COMPONENTS_FILE);
  });
});
