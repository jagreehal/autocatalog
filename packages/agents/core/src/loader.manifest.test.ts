import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCatalog, refKey } from './loader.js';

const roots: string[] = [];

const write = async (path: string, content: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'autocatalog-agents-manifest-'));
  roots.push(root);

  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('loadCatalog manifest-first entities', () => {
  it('loads agent metadata from autocatalog.json with optional narrative body', async () => {
    const root = await makeRoot();
    await write(
      join(root, 'models', 'reasoner', 'autocatalog.json'),
      JSON.stringify(
        {
          name: 'Reasoner',
          owner: 'platform',
          provider: 'openai',
          model_id: 'gpt-x',
        },
        null,
        2,
      ),
    );
    await write(
      join(root, 'agents', 'planner', 'autocatalog.json'),
      JSON.stringify(
        {
          name: 'Planner',
          owner: 'ops',
          model: 'reasoner',
          tools: [],
          policies: [],
        },
        null,
        2,
      ),
    );
    await write(join(root, 'agents', 'planner', 'index.mdx'), '# Planner\n\nNarrative body.\n');

    const catalog = await loadCatalog(root);
    const agent = catalog.entities.get('agent')?.get('planner');
    expect(agent?.name).toBe('Planner');
    expect(catalog.meta.get(refKey('agent', 'planner'))?.body).toContain('Narrative body.');
    expect(catalog.issues).toEqual([]);
  });

  it('loads models from manifest directories instead of requiring flat yaml files', async () => {
    const root = await makeRoot();
    await write(
      join(root, 'models', 'fast-model', 'autocatalog.json'),
      JSON.stringify(
        {
          name: 'Fast Model',
          owner: 'platform',
          provider: 'anthropic',
          model_id: 'claude-fast',
        },
        null,
        2,
      ),
    );

    const catalog = await loadCatalog(root);
    const model = catalog.entities.get('model')?.get('fast-model');
    expect(model?.name).toBe('Fast Model');
    expect(catalog.meta.get(refKey('model', 'fast-model'))?.path).toMatch(/autocatalog\.json$/);
  });
});
