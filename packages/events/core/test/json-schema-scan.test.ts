import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverJsonSchemas,
  domainForJsonPath,
  idFromFilename,
  idFromSchemaId,
  looksLikeJsonSchema,
  adapterEventToFrontmatter,
  mergeDiscoveries,
  validateDiscoveryResult,
  writeEventFolder,
  type AdapterEvent,
} from '../src/index';
import {
  loadedEventToAdapterEvent,
  parseAdapterEventMeta,
  readVendorMeta,
} from '../src/adapter-event';
import { eventFrontmatter } from '../src/schema';
import { loadCatalog } from '../src/load';
import type { JsonObject } from '../src/json';

const here = path.dirname(fileURLToPath(import.meta.url));

const jsonSchemaRepo = path.resolve(here, '../../../../fixtures/json-schema-repo');

describe('looksLikeJsonSchema', () => {
  it('accepts $schema / type+properties / combinators', () => {
    expect(looksLikeJsonSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe(
      true,
    );
    expect(looksLikeJsonSchema({ type: 'object', properties: { id: { type: 'string' } } })).toBe(
      true,
    );
    expect(looksLikeJsonSchema({ allOf: [{ type: 'object' }] })).toBe(true);
  });

  it('rejects package-like and empty objects', () => {
    expect(looksLikeJsonSchema({ name: 'pkg', dependencies: {} })).toBe(false);
    expect(looksLikeJsonSchema({})).toBe(false);
    expect(looksLikeJsonSchema(null)).toBe(false);
  });
});

describe('id helpers', () => {
  it('idFromFilename dots camel and kebab names', () => {
    expect(idFromFilename('ShipmentDispatched.schema.json')).toBe('shipment.dispatched');
    expect(idFromFilename('payment-completed.json')).toBe('payment.completed');
    expect(idFromFilename('refund.issued.json')).toBe('refund.issued');
  });

  it('idFromSchemaId reads URL basenames', () => {
    expect(idFromSchemaId('https://example.com/schemas/refund.issued.json')).toBe('refund.issued');
  });

  it('domainForJsonPath prefers meaningful path segments', () => {
    expect(domainForJsonPath('schemas/payments/refund.issued.json', 'refund.issued')).toEqual({
      domain: 'payments',
      from: 'path',
    });
  });

  // Observed on a real repository: `contracts/events/payment.completed.json`
  // produced a domain called "contracts", which is the directory answering.
  it('does not let a filing convention name the domain', () => {
    expect(
      domainForJsonPath('contracts/events/payment.completed.json', 'payment.completed'),
    ).toEqual({ domain: 'payment', from: 'id' });
    expect(domainForJsonPath('src/schemas/order.placed.json', 'order.placed')).toEqual({
      domain: 'order',
      from: 'id',
    });
  });
});

// Observed on SchemaStore: one file whose `$id` ended in `/schema` derived an
// empty id, which fails the discovery contract and aborts the entire scan.
describe('id derivation never yields an empty id', () => {
  it('keeps the name when stripping "Schema" would consume it', () => {
    expect(idFromFilename('schema')).toBe('schema');
    expect(idFromFilename('Schema')).toBe('schema');
    expect(idFromFilename('schema.json')).toBe('schema');
  });

  it('falls through to the filename when a $id derives nothing', () => {
    expect(idFromSchemaId('https://w3id.org/kya/v1/schema')).toBe('schema');
    expect(idFromSchemaId('#/')).toBeUndefined();
  });
});

describe('discoverJsonSchemas', () => {
  it('finds schemas, applies sidecar/x-autocatalog, skips noise', async () => {
    const result = await discoverJsonSchemas({ root: jsonSchemaRepo });
    expect(result.errors).toEqual([]);
    const ids = result.events.map((e) => e.id).sort();
    expect(ids).toEqual(['refund.issued', 'shipment.dispatched']);

    const refund = result.events.find((e) => e.id === 'refund.issued')!;
    expect(refund.version).toBe('1.0.0');
    expect(refund.domain).toBe('payments');
    expect(refund.meta?.producers).toEqual(['RefundService']);
    expect(refund.needsReview).toBe(false);
    expect(refund.provenance?.default).toBe('extracted');

    const shipment = result.events.find((e) => e.id === 'shipment.dispatched')!;
    expect(shipment.version).toBe('1.2.0');
    expect(shipment.name).toBe('Shipment Dispatched');
    expect(shipment.meta?.consumers).toEqual(['NotificationService']);
  });
});

describe('scanning a repository that keeps schemas in events/', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-events-dir-'));
    await fs.mkdir(path.join(tmp, 'contracts', 'events'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'contracts', 'events', 'payment.completed.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { id: { type: 'string' } },
        'x-eventcatalog': {
          id: 'payment.completed',
          version: '1.0.0',
          producers: ['payments-service'],
          owners: ['payments-platform'],
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // `events` used to be excluded by name at any depth, so the likeliest
  // directory in the repository to hold event schemas was the one place the
  // scanner refused to look.
  it('discovers schemas under a directory named events', async () => {
    const result = await discoverJsonSchemas({ root: tmp });
    expect(result.candidates.map((candidate) => candidate.event.id)).toEqual(['payment.completed']);
  });

  it('still skips the catalog output directory, which is matched by path', async () => {
    const out = path.join(tmp, 'events');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(
      path.join(out, 'published.json'),
      JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }),
    );
    const result = await discoverJsonSchemas({ root: tmp, outDir: out });
    expect(result.candidates.map((candidate) => candidate.event.id)).toEqual(['payment.completed']);
  });

  it("skips the project's own contracts, which describe manifests and documents", async () => {
    for (const contract of ['event-manifest.json', 'docs-frontmatter.json']) {
      await fs.writeFile(
        path.join(tmp, 'contracts', contract),
        JSON.stringify({ type: 'object', properties: { owner: { type: 'string' } } }),
      );
    }

    const result = await discoverJsonSchemas({ root: tmp });
    expect(result.candidates.map((candidate) => candidate.event.id)).toEqual(['payment.completed']);
  });

  it('reads x-eventcatalog metadata, so a documented event needs no review', async () => {
    const [candidate] = (await discoverJsonSchemas({ root: tmp })).candidates;
    expect(candidate!.event.version).toBe('1.0.0');
    expect(candidate!.event.meta?.producers).toEqual(['payments-service']);
    expect(candidate!.event.meta?.owner).toEqual({ team: 'payments-platform' });
    expect(candidate!.event.needsReview).toBe(false);
    // The domain was not declared and the path is all filing convention, so the
    // event is well identified with one guessed field — visible as confidence,
    // not as a review flag on an otherwise complete event.
    expect(candidate!.event.domain).toBe('payment');
    expect(candidate!.event.confidence).toBe(0.75);
    expect(candidate!.event.provenance?.fields?.domain).toBe('inferred');
  });
});

describe('invalid event metadata', () => {
  it('reaches validation as written, and fails it with the event and field named', () => {
    const meta = parseAdapterEventMeta({ status: 'retired', owners: ['payments'] });
    expect(meta).toMatchObject({ status: 'retired', owner: { team: 'payments' } });

    const event: AdapterEvent = {
      id: 'payment.completed',
      version: '1.0.0',
      name: 'Payment completed',
      summary: 'x',
      domain: 'payments',
      folderName: 'PaymentCompleted',
      schema: { type: 'object' },
      examples: [],
      meta,
    };

    expect(() => adapterEventToFrontmatter(event)).toThrow(
      /payment\.completed: invalid event metadata[\s\S]*status/,
    );
  });
});

describe('validateDiscoveryResult', () => {
  it('accepts an event that omits the fields discovery-v1 never checked', () => {
    const minimal = {
      id: 'payment.completed',
      domain: 'payments',
      folderName: 'PaymentCompleted',
      schema: { type: 'object' },
      examples: [],
    };

    const finding = {
      id: 'payment.completed',
      file: 'a.json',
      symbol: 'a',
      kind: 'json-schema',
      needsReview: true,
    };

    const result = validateDiscoveryResult('test', {
      candidates: [{ event: minimal, finding }],
      errors: [],
    });

    expect(result.candidates[0]?.event).toEqual(minimal);
  });
});

describe('mergeDiscoveries', () => {
  it('keeps the higher-confidence event when ids collide', () => {
    const low: AdapterEvent = {
      id: 'payment.completed',
      version: '0.1.0',
      name: 'Payment Completed',
      summary: 'from json',
      domain: 'payments',
      folderName: 'PaymentCompleted',
      schema: { type: 'object' },
      examples: [],
      provenance: { default: 'inferred' },
      confidence: 0.4,
      needsReview: true,
    };

    const high: AdapterEvent = {
      ...low,
      summary: 'from zod',
      provenance: { default: 'extracted' },
      confidence: 0.95,
      needsReview: false,
    };

    const merged = mergeDiscoveries([
      {
        events: [low],
        findings: [
          {
            file: 'a.json',
            symbol: 'a.json',
            kind: 'json-schema',
            id: 'payment.completed',
            needsReview: true,
            source: 'json-schema',
          },
        ],
        errors: [],
      },
      {
        events: [high],
        findings: [
          {
            file: 'a.ts',
            symbol: 'PaymentCompleted',
            kind: 'defineEvent',
            id: 'payment.completed',
            needsReview: false,
            source: 'zod',
          },
        ],
        errors: [],
      },
    ]);

    expect(merged.events).toHaveLength(1);
    expect(merged.events[0]!.summary).toBe('from zod');
    expect(merged.findings[0]!.source).toBe('zod');
    expect(merged.conflicts).toEqual([
      expect.objectContaining({
        eventId: 'payment.completed',
        winner: 'zod:a.ts',
        ignored: 'json-schema:a.json',
      }),
    ]);
  });
});

describe('writeEventFolder (core)', () => {
  let tmp: string;

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

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-core-writer-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes the same name into two case folders, since their paths differ', async () => {
    await writeEventFolder({
      outRoot: tmp,
      event: {
        ...evt,
        examples: [
          { name: 'sample', data: { id: 'pay_1' } },
          { name: 'sample', case: 'duplicate', data: { id: 'pay_1' } },
        ],
      },
    });

    const examples = path.join(tmp, 'payment/PaymentCompleted/examples');
    await expect(fs.access(path.join(examples, 'sample.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(examples, 'duplicate/sample.json'))).resolves.toBeUndefined();
  });

  it('writes an edge-case example into its case folder, where a rescan keeps it', async () => {
    const cased: AdapterEvent = {
      ...evt,
      examples: [
        { name: 'default', data: { id: 'pay_1' } },
        { name: 'redelivered', case: 'duplicate', data: { id: 'pay_1' } },
      ],
    };

    const folder = path.join(tmp, 'payment/PaymentCompleted');

    // Once a happy-path example, now a case: the old top-level file goes.
    await writeEventFolder({
      outRoot: tmp,
      event: { ...evt, examples: [{ name: 'redelivered', data: { id: 'pay_1' } }] },
    });
    await writeEventFolder({ outRoot: tmp, event: cased });
    await expect(fs.access(path.join(folder, 'examples/redelivered.json'))).rejects.toThrow();

    expect(
      JSON.parse(
        await fs.readFile(path.join(folder, 'examples/duplicate/redelivered.json'), 'utf8'),
      ),
    ).toEqual({ id: 'pay_1' });

    // A rescan that no longer produces it leaves a case folder alone: people write those too.
    await writeEventFolder({ outRoot: tmp, event: evt });
    await expect(
      fs.access(path.join(folder, 'examples/duplicate/redelivered.json')),
    ).resolves.toBeUndefined();

    const [loaded] = await loadCatalog(tmp);

    expect(loadedEventToAdapterEvent(loaded!).examples).toEqual([
      { name: 'default', data: { id: 'pay_1' } },
      { name: 'redelivered', case: 'duplicate', data: { id: 'pay_1' } },
    ]);
  });

  it('writes autocatalog.json + schema.json + examples', async () => {
    await writeEventFolder({ outRoot: tmp, event: evt });
    const folder = path.join(tmp, 'payment/PaymentCompleted');
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'autocatalog.json'), 'utf8'));
    expect(manifest.id).toBe('payment.completed');
    expect(manifest.spec).toBe('autocatalog/v2');
  });
});

describe('schemas in a folder named commands', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-commands-folder-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const write = async (file: string, value: JsonObject) => {
    await fs.mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
    await fs.writeFile(path.join(tmp, file), JSON.stringify(value));
  };

  const object = { type: 'object', properties: { id: { type: 'string' } } };

  it('discovers an event schema kept in a commands folder', async () => {
    await write('src/commands/order-placed.schema.json', object);

    expect((await discoverJsonSchemas({ root: tmp })).events.map((event) => event.id)).toEqual([
      'order.placed',
    ]);
  });

  it("does not catalog a command's payload or result schema as an event", async () => {
    await write('commands/generate-statement/autocatalog.json', {
      kind: 'command',
      id: 'generate-statement',
      version: '1.0.0',
      name: 'Generate statement',
      summary: 'Builds a statement',
      outcome: { type: 'result', schema: './result.json' },
    });
    await write('commands/generate-statement/schema.json', object);
    await write('commands/generate-statement/result.json', object);

    expect((await discoverJsonSchemas({ root: tmp })).events).toEqual([]);
  });
});

describe('delivery declared in x-autocatalog', () => {
  it('reaches the catalog entry, and survives a rescan of it', () => {
    const delivery = {
      guarantee: 'at-least-once',
      orderingKey: 'orderId',
      idempotencyKey: 'orderId',
    };

    const schema = { type: 'object', 'x-autocatalog': { delivery } };

    const frontmatter = adapterEventToFrontmatter({
      id: 'order.placed',
      version: '1.0.0',
      name: 'Order placed',
      summary: 's',
      domain: 'orders',
      folderName: 'OrderPlaced',
      schema,
      examples: [],
      meta: readVendorMeta(schema),
    });

    expect(frontmatter.delivery).toEqual(delivery);

    const rescanned = loadedEventToAdapterEvent({
      frontmatter: { ...eventFrontmatter.parse(frontmatter), domain: 'orders' },
      folder: {
        path: 'orders/OrderPlaced',
        defaultDomain: 'orders',
        isVersioned: false,
        parentEventPath: null,
      },
      body: '',
      schemaPath: 'orders/OrderPlaced/schema.json',
      schema,
      examples: [],
    });

    expect(rescanned.meta?.delivery).toEqual(delivery);
  });
});
