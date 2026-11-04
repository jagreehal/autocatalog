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

async function install(name: string, plugin?: AdapterBlock, field = 'plugin') {
  const dir = path.join(cwd, 'node_modules', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, ...(plugin && { autocatalog: { [field]: plugin } }) }),
  );
}

describe('discoverAdapters', () => {
  it('finds plugins installed under their own name or a company scope', async () => {
    await install('autocatalog-plugin-kafka', { command: 'from-kafka', entry: 'bin.js' });
    await install('@acme/autocatalog-plugin-billing', {
      command: 'from-billing',
      entry: 'bin.js',
    });

    const found = await discoverAdapters(cwd);

    expect(found.map((adapter) => adapter.packageName).sort()).toEqual([
      '@acme/autocatalog-plugin-billing',
      'autocatalog-plugin-kafka',
    ]);
  });

  it('passes over packages that only share the prefix, or declare nothing', async () => {
    await install('@acme/billing', { command: 'from-billing', entry: 'bin.js' });
    await install('@acme/autocatalog-plugin-empty');
    await install('autocatalog-core');

    expect(await discoverAdapters(cwd)).toEqual([]);
  });

  it('finds nothing in a project with no node_modules', async () => {
    expect(await discoverAdapters(cwd)).toEqual([]);
  });

  it('names a scanner after its package, keeping the scope so two companies never collide', async () => {
    const discovery = { entry: 'index.js', export: 'adapter' };
    await install('autocatalog-plugin-kafka', { discovery });
    await install('@acme/autocatalog-plugin-kafka', { discovery });

    const scanners = await discoverDiscoveryAdapters(cwd, { allowCodeExecution: true });

    expect(scanners.map((scanner) => scanner.name).sort()).toEqual(['@acme/kafka', 'kafka']);
  });

  describe('a package from before the rename', () => {
    const discovery = { entry: 'index.js', export: 'adapter' };

    it('is still found, under its old prefix and field', async () => {
      await install('@acme/autocatalog-adapter-orders', { discovery }, 'adapter');

      const scanners = await discoverDiscoveryAdapters(cwd, { allowCodeExecution: true });

      expect(scanners.map((scanner) => scanner.name)).toEqual(['@acme/orders']);
    });

    it('gives way to its renamed package, so a command registers once', async () => {
      const command = { command: 'from-orders', entry: 'bin.js' };

      await install('autocatalog-adapter-orders', command, 'adapter');
      await install('autocatalog-plugin-orders', command);

      const manifests = await discoverAdapters(cwd);

      expect(manifests.map(({ packageName }) => packageName)).toEqual([
        'autocatalog-plugin-orders',
      ]);
    });

    it('keeps a plugin and an old package that are different things', async () => {
      await install('autocatalog-adapter-orders', { discovery }, 'adapter');
      await install('autocatalog-plugin-billing', { discovery });

      const manifests = await discoverAdapters(cwd);

      expect(manifests).toHaveLength(2);
    });
  });
});
