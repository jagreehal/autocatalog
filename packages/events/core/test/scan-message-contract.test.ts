import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtInDiscoveryAdapters } from '../src/built-in-adapters';
import type { JsonValue } from '../src/json';
import { mergeDiscoveries } from '../src/merge-discoveries';
import { discoverJsonSchemas } from '../src/scan-json-schema';
import { discoverMessageContracts, inferJsonSchema } from '../src/scan-message-contract';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'message-contract-scan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
}

// What autotel-message-contract's default serializer writes: JSON.stringify
// with sorted keys and a 2-space indent, no trailing newline, no header.
const approved = (value: JsonValue) => JSON.stringify(value, undefined, 2);

const orderPlaced = {
  customer: 'Alice',
  items: [{ qty: 2, sku: 'SKU-1' }],
  note: null,
  orderId: 'ord-1',
  paid: true,
  total: 42.5,
};

describe('inferJsonSchema', () => {
  it('claims only what one sample proves', () => {
    expect(inferJsonSchema(orderPlaced)).toEqual({
      type: 'object',
      properties: {
        customer: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { qty: { type: 'number' }, sku: { type: 'string' } },
          },
        },
        // null says the field is written, not what it holds when it is set.
        note: {},
        orderId: { type: 'string' },
        paid: { type: 'boolean' },
        total: { type: 'number' },
      },
      // One message shows a field present, not that every message carries it.
    });
  });

  it('leaves array items open when the elements disagree or there are none', () => {
    expect(inferJsonSchema([1, 'a'])).toEqual({ type: 'array', items: {} });
    expect(inferJsonSchema([])).toEqual({ type: 'array' });
  });
});

describe('discoverMessageContracts', () => {
  it('turns an approved file under __contracts__/ into an event, schema marked inferred', async () => {
    await write('src/orders/__contracts__/OrderPlaced.approved.txt', approved(orderPlaced));

    const { candidates, skipped } = await discoverMessageContracts({ root });
    expect(skipped).toEqual([]);
    expect(candidates).toHaveLength(1);
    const { event, finding } = candidates[0]!;

    expect(event).toMatchObject({
      id: 'order.placed',
      name: 'OrderPlaced',
      version: '0.1.0',
      domain: 'orders',
      examples: [{ name: 'approved', data: orderPlaced }],
      source: {
        type: 'code',
        file: 'src/orders/__contracts__/OrderPlaced.approved.txt',
        symbol: 'OrderPlaced',
        line: 1,
      },
      provenance: {
        default: 'inferred',
        fields: {
          id: 'inferred',
          version: 'inferred',
          domain: 'inferred',
          summary: 'inferred',
          schema: 'inferred',
          examples: 'extracted',
        },
      },
      needsReview: true,
    });
    expect(finding).toMatchObject({ kind: 'message-contract', source: 'message-contract' });
  });

  it('reads nothing outside a __contracts__ directory', async () => {
    await write('src/OrderPlaced.approved.txt', approved(orderPlaced));
    await write('src/__contracts__/notes.txt', approved(orderPlaced));

    expect((await discoverMessageContracts({ root })).candidates).toEqual([]);
  });

  it('takes declared metadata from a sidecar', async () => {
    await write('src/__contracts__/OrderPlaced.approved.txt', approved(orderPlaced));
    await write(
      'src/__contracts__/OrderPlaced.approved.autocatalog.json',
      JSON.stringify({
        id: 'order.placed',
        version: '2.0.0',
        domain: 'sales',
        consumers: ['Billing'],
      }),
    );

    const { candidates } = await discoverMessageContracts({ root });

    expect(candidates[0]?.event).toMatchObject({
      version: '2.0.0',
      domain: 'sales',
      needsReview: false,
      provenance: { fields: { id: 'declared', version: 'declared', domain: 'declared' } },
    });
  });

  it('refuses a sidecar that does not read rather than dropping its metadata', async () => {
    await write('src/__contracts__/OrderPlaced.approved.txt', approved(orderPlaced));
    await write('src/__contracts__/OrderPlaced.approved.autocatalog.json', '{ "id": ');
    await write('src/__contracts__/Refunded.approved.txt', approved({ id: 'r' }));
    await write('src/__contracts__/Refunded.approved.autocatalog.json', '["refund.requested"]');

    const { candidates, errors } = await discoverMessageContracts({ root });

    expect(candidates).toEqual([]);
    expect(errors).toEqual([
      expect.stringMatching(/^src\/__contracts__\/OrderPlaced\.approved\.autocatalog\.json: /),
      'src/__contracts__/Refunded.approved.autocatalog.json: sidecar is not a JSON object',
    ]);
  });

  it('catalogs the current snapshot and skips the pinned older versions beside it', async () => {
    await write('src/__contracts__/OrderPlaced.approved.txt', approved(orderPlaced));
    await write('src/__contracts__/OrderPlaced_v1.approved.txt', approved({ orderId: 'ord-1' }));
    await write('src/__contracts__/Refunded_v1.approved.txt', approved({ id: 'r' }));
    await write('src/__contracts__/Refunded_v2.approved.txt', approved({ id: 'r', reason: 'x' }));

    const { candidates, skipped } = await discoverMessageContracts({ root });

    expect(candidates.map(({ event }) => [event.source?.file, event.version])).toEqual([
      ['src/__contracts__/OrderPlaced.approved.txt', '0.1.0'],
      ['src/__contracts__/Refunded_v2.approved.txt', '2.0.0'],
    ]);
    expect(candidates[1]!.event.provenance?.fields?.version).toBe('extracted');
    expect(skipped).toEqual([
      'src/__contracts__/OrderPlaced_v1.approved.txt: an earlier version of order.placed, kept for compatibility checks; src/__contracts__/OrderPlaced.approved.txt is cataloged',
      'src/__contracts__/Refunded_v1.approved.txt: an earlier version of refunded, kept for compatibility checks; src/__contracts__/Refunded_v2.approved.txt is cataloged',
    ]);
  });

  it('skips a snapshot that is not JSON, saying why', async () => {
    await write('src/__contracts__/Ping.approved.txt', 'CgVvcmQtMRIFQWxpY2U=');

    const { candidates, skipped, errors } = await discoverMessageContracts({ root });
    expect(candidates).toEqual([]);
    expect(errors).toEqual([]);
    expect(skipped).toEqual([
      'src/__contracts__/Ping.approved.txt: not JSON (a custom serializer?), so its payload shape cannot be read; declare the event with a JSON Schema',
    ]);
  });

  it('is a built-in, passive adapter', () => {
    expect(builtInDiscoveryAdapters.map((adapter) => adapter.name)).toContain('message-contract');
  });
});

describe('a message declared both as a JSON Schema and a message contract', () => {
  it('resolves to the written schema in either order, and records the conflict', async () => {
    await write('src/__contracts__/OrderPlaced.approved.txt', approved(orderPlaced));
    await write(
      'contracts/order-placed.json',
      JSON.stringify({
        $id: 'order.placed',
        type: 'object',
        properties: { orderId: { type: 'string' } },
      }),
    );

    const contracts = await discoverMessageContracts({ root });
    const schemas = await discoverJsonSchemas({ root });
    const forward = mergeDiscoveries([contracts, schemas]);
    const backward = mergeDiscoveries([schemas, contracts]);

    expect(forward.events).toEqual(backward.events);
    expect(forward.events.map((event) => event.source?.file)).toEqual([
      'contracts/order-placed.json',
    ]);
    expect(forward.conflicts).toEqual([
      {
        eventId: 'order.placed',
        winner: 'json-schema:contracts/order-placed.json',
        ignored: 'message-contract:src/__contracts__/OrderPlaced.approved.txt',
        reason: 'higher provenance/confidence',
      },
    ]);
    expect(backward.conflicts).toEqual(forward.conflicts);
  });
});
