import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverAdapters, discoverDiscoveryAdapters } from '../src/adapters';

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-adapters-'));
});

afterEach(() => fs.rm(cwd, { recursive: true, force: true }));

interface AdapterBlock {
  command?: string;
  entry?: string;
  discovery?: { entry: string; export: string };
}

async function install(name: string, adapter?: AdapterBlock) {
  const dir = path.join(cwd, 'node_modules', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, ...(adapter && { autocatalog: { adapter } }) }),
  );
}

describe('discoverAdapters', () => {
  it('finds adapters installed under their own name or a company scope', async () => {
    await install('autocatalog-adapter-kafka', { command: 'from-kafka', entry: 'bin.js' });
    await install('@acme/autocatalog-adapter-billing', {
      command: 'from-billing',
      entry: 'bin.js',
    });

    const found = await discoverAdapters(cwd);

    expect(found.map((adapter) => adapter.packageName).sort()).toEqual([
      '@acme/autocatalog-adapter-billing',
      'autocatalog-adapter-kafka',
    ]);
  });

  it('passes over packages that only share the prefix, or declare nothing', async () => {
    await install('@acme/billing', { command: 'from-billing', entry: 'bin.js' });
    await install('@acme/autocatalog-adapter-empty');
    await install('autocatalog-core');

    expect(await discoverAdapters(cwd)).toEqual([]);
  });

  it('finds nothing in a project with no node_modules', async () => {
    expect(await discoverAdapters(cwd)).toEqual([]);
  });

  it('names a scanner after its package, keeping the scope so two companies never collide', async () => {
    const discovery = { entry: 'index.js', export: 'adapter' };
    await install('autocatalog-adapter-kafka', { discovery });
    await install('@acme/autocatalog-adapter-kafka', { discovery });

    const scanners = await discoverDiscoveryAdapters(cwd, { allowCodeExecution: true });

    expect(scanners.map((scanner) => scanner.name).sort()).toEqual(['@acme/kafka', 'kafka']);
  });
});
