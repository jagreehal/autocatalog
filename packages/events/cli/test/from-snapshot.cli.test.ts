import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog } from 'autocatalog-core';
import { inferSchema, runFromSnapshot } from '../src/commands/from-snapshot';

describe('ac from-snapshot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-from-snapshot-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('types each observed field, nests objects and arrays, and requires nothing', () => {
    expect(
      inferSchema({
        name: 'order.placed',
        observedCount: 2,
        firstSeen: '',
        lastSeen: '',
        fieldPaths: ['customer', 'customer.id', 'items', 'items[].sku', 'note', 'total'],
        fieldStats: {
          customer: { types: ['object'] },
          'customer.id': { types: ['string'], sampleValues: ['c-1'] },
          items: { types: ['array'] },
          'items[].sku': { types: ['string'] },
          note: { types: ['null', 'string', 'undefined'] },
          total: { types: ['number'], sampleValues: [42] },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        customer: { type: 'object', properties: { id: { type: 'string' } } },
        items: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } } },
        },
        note: { type: ['null', 'string'] },
        total: { type: 'number' },
      },
    });
  });

  it('keeps fields named after object internals, and leaves the prototype alone', () => {
    const schema = inferSchema({
      name: 'odd.names',
      observedCount: 1,
      firstSeen: '',
      lastSeen: '',
      fieldPaths: ['constructor', '__proto__.polluted'],
    });

    // As a string: an object literal's `__proto__` key would set its prototype instead.
    expect(JSON.stringify(schema.properties)).toBe(
      '{"__proto__":{"type":"object","properties":{"polluted":{}}},"constructor":{}}',
    );
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('writes draft events with their producers, consumers, channel and evidence, and no sample values', async () => {
    const file = path.join(dir, 'snapshot.json');
    const out = path.join(dir, 'events');

    await fs.writeFile(
      file,
      JSON.stringify({
        spec: 'autotel-architecture/v1',
        generatedAt: '2026-01-01T00:00:00Z',
        service: 'orders',
        events: {
          'order.placed': {
            name: 'order.placed',
            observedCount: 3,
            firstSeen: '2026-01-01T00:00:00Z',
            lastSeen: '2026-01-01T00:00:00Z',
            producer: 'OrderService',
            channel: 'orders.events',
            consumers: ['BillingService'],
            fieldPaths: ['orderId'],
            fieldStats: { orderId: { types: ['string'], sampleValues: ['secret-order-1'] } },
          },
        },
      }),
    );

    await expect(runFromSnapshot({ file, out, quiet: true })).resolves.toBe(0);

    const [event] = await loadCatalog(out);

    expect(event?.frontmatter).toMatchObject({
      id: 'order.placed',
      domain: 'orders',
      status: 'draft',
      producers: ['OrderService'],
      consumers: ['BillingService'],
      transport: [{ address: 'orders.events', protocols: [] }],
      needsReview: true,
      provenance: { default: 'inferred' },
      observed: { count: 3 },
    });
    expect(event?.schema).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string' } },
    });

    const written = await fs.readdir(out, { recursive: true });

    const text = await Promise.all(
      written
        .map((name) => path.join(out, String(name)))
        .map((file) => fs.readFile(file, 'utf8').catch(() => '')),
    );

    expect(text.join('\n')).not.toContain('secret-order-1');
  });

  it('refuses a file that is not a snapshot', async () => {
    const file = path.join(dir, 'other.json');
    await fs.writeFile(file, '{"spec":"something/v1","events":{}}');

    await expect(
      runFromSnapshot({ file, out: path.join(dir, 'events'), quiet: true }),
    ).resolves.toBe(1);
  });
});
