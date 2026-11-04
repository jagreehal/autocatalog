import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeEventFolder } from '../src/writer';
import type { AdapterEvent } from '../src/event-mapper';

const evt: AdapterEvent = {
  id: 'payment.completed',
  version: 'v1',
  name: 'Payment Completed',
  summary: 'Fires when a payment completes',
  domain: 'payment',
  folderName: 'PaymentCompleted',
  schema: { type: 'object', properties: { id: { type: 'string' } } },
  examples: [{ name: 'default', data: { id: 'pay_1' } }],
};

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-writer-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('writeEventFolder', () => {
  it('creates the full folder structure on first write', async () => {
    await writeEventFolder({ outRoot: tmp, event: evt });
    const folder = path.join(tmp, 'payment/PaymentCompleted');
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'autocatalog.json'), 'utf8'));
    const schema = JSON.parse(await fs.readFile(path.join(folder, 'schema.json'), 'utf8'));

    const example = JSON.parse(
      await fs.readFile(path.join(folder, 'examples/default.json'), 'utf8'),
    );

    expect(manifest.id).toBe('payment.completed');
    expect(manifest.version).toBe('v1');
    expect(manifest.name).toBe('Payment Completed');
    // no index.mdx is seeded — narrative is human-authored only
    await expect(fs.access(path.join(folder, 'index.mdx'))).rejects.toThrow();
    expect(schema.type).toBe('object');
    expect(example).toEqual({ id: 'pay_1' });
  });

  it('overwrites schema and examples on re-run but preserves MDX body', async () => {
    const folder = path.join(tmp, 'payment/PaymentCompleted');

    await writeEventFolder({ outRoot: tmp, event: evt });

    // Simulate a human authoring narrative MDX
    const mdxPath = path.join(folder, 'index.mdx');
    await fs.writeFile(mdxPath, 'Human-authored paragraph that must survive.\n');

    // Change the schema and re-run
    const updated: AdapterEvent = {
      ...evt,
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, amount: { type: 'number' } },
      },
      examples: [{ name: 'default', data: { id: 'pay_2', amount: 999 } }],
    };

    await writeEventFolder({ outRoot: tmp, event: updated });

    const mdxAfter = await fs.readFile(mdxPath, 'utf8');
    const schemaAfter = JSON.parse(await fs.readFile(path.join(folder, 'schema.json'), 'utf8'));

    const exampleAfter = JSON.parse(
      await fs.readFile(path.join(folder, 'examples/default.json'), 'utf8'),
    );

    expect(mdxAfter).toContain('Human-authored paragraph that must survive.');
    expect(schemaAfter.properties.amount).toBeDefined();
    expect(exampleAfter).toEqual({ id: 'pay_2', amount: 999 });
  });

  it('removes example files that no longer exist in the source', async () => {
    await writeEventFolder({
      outRoot: tmp,
      event: {
        ...evt,
        examples: [
          { name: 'default', data: {} },
          { name: 'extra', data: { foo: 1 } },
        ],
      },
    });

    // Re-run with only `default`
    await writeEventFolder({ outRoot: tmp, event: evt });

    const folder = path.join(tmp, 'payment/PaymentCompleted');
    const entries = await fs.readdir(path.join(folder, 'examples'));
    expect(entries.sort()).toEqual(['default.json']);
  });
});
