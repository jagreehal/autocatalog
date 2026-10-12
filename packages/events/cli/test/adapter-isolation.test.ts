import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdapterExecutionError,
  createIsolatedDiscoveryAdapter,
  type AdapterManifest,
} from '../src/adapters';

const roots: string[] = [];

async function adapter(source: string, timeoutMs = 2_000) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-adapter-isolation-'));
  roots.push(root);
  const entry = path.join(root, 'adapter.mjs');
  await fs.writeFile(entry, source);

  const manifest: AdapterManifest = {
    packageName: 'autocatalog-adapter-test',
    description: 'test',
    discoveryEntryAbs: entry,
    discoveryExport: 'testAdapter',
  };

  return {
    root,
    implementation: createIsolatedDiscoveryAdapter(manifest, { timeoutMs }),
  };
}

afterEach(async () => {
  // maxRetries covers Windows: a SIGKILLed adapter releases its handles on the
  // directory asynchronously, so an immediate rmdir loses the race with EBUSY.
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('runtime Discovery Adapter isolation', () => {
  it('exchanges a bounded, versioned discovery result', async () => {
    const { root, implementation } = await adapter(`
      export const testAdapter = {
        async discover() {
          const event = {
            id: 'test.created', version: '1.0.0', name: 'Test Created',
            summary: 'A test.', domain: 'test', folderName: 'TestCreated',
            schema: { type: 'object' }, examples: []
          };
          return { candidates: [{ event, finding: {
            file: 'event.ts', symbol: 'TestCreated', kind: 'test',
            id: event.id, needsReview: false, source: 'test'
          } }], errors: [] };
        }
      };
    `);

    const result = await implementation.discover({ root });
    expect(result.candidates[0]?.event.id).toBe('test.created');
  });

  it('denies repository writes and reports the Adapter crash', async () => {
    const { root, implementation } = await adapter(`
      import fs from 'node:fs';
      import path from 'node:path';
      export const testAdapter = {
        async discover({ root }) {
          fs.writeFileSync(path.join(root, 'owned.txt'), 'no');
          return { candidates: [], errors: [] };
        }
      };
    `);

    await expect(implementation.discover({ root })).rejects.toBeInstanceOf(AdapterExecutionError);
    await expect(fs.access(path.join(root, 'owned.txt'))).rejects.toThrow();
  });

  it('kills an Adapter that exceeds its time limit', async () => {
    const { root, implementation } = await adapter(
      `export const testAdapter = { async discover() { while (true) {} } };`,
      100,
    );

    await expect(implementation.discover({ root })).rejects.toMatchObject({
      code: 'adapter_timeout',
    });
  });
});
