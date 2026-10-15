import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import utils from '@eventcatalog/sdk';
import { exportToEventCatalog, loadEventCatalogSources, provenanceLine } from '../src/eventcatalog';
import { runFromEventCatalog } from '../src/commands/from-eventcatalog';
import { loadCatalog, type JsonObject, type JsonValue } from 'autocatalog-core';

/** The CLI's path: load each `events/` root, then export them. */
const exportRoots = async ({
  roots,
  ...rest
}: {
  roots: string[];
  catalogDir: string;
  narrative?: boolean;
}) => exportToEventCatalog({ catalogs: await loadEventCatalogSources(roots), ...rest });

const here = path.dirname(fileURLToPath(import.meta.url));

const demoRepo = path.resolve(here, '../../../../fixtures/demo-repo');

// Reads the export back through EventCatalog's own SDK, so the test holds the
// output to what EventCatalog understands, not to a copy of its file layout.
describe('ac to-eventcatalog', () => {
  let work: string;
  let catalog: string;
  let sdk: ReturnType<typeof utils>;
  let written: Awaited<ReturnType<typeof exportToEventCatalog>>['written'];

  beforeAll(async () => {
    const { scanRepo } = await import('autocatalog-adapter-zod');
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-eventcatalog-'));
    const events = path.join(work, 'events');
    catalog = path.join(work, 'catalog');
    await scanRepo({ root: demoRepo, out: events });
    written = (await exportRoots({ roots: [events], catalogDir: catalog })).written;
    sdk = utils(catalog);
  });
  afterAll(() => fs.rm(work, { recursive: true, force: true }));

  it('says what EventCatalog calls each resource it wrote, for pages that link to it', async () => {
    const event = await sdk.getEvent('payment.completed');
    expect(written.events['payment.completed']).toEqual({ id: event?.id, version: event?.version });
    expect(written.services.PaymentService).toEqual({ id: 'PaymentService', version: '1.0.0' });
    expect(written.domains.payments).toEqual({ id: 'payments', version: '1.0.0' });
  });

  it('writes each event with its schema and the line saying where it was found', async () => {
    const event = await sdk.getEvent('payment.completed');
    expect(event?.schemaPath).toBe('schema.json');
    expect(event?.markdown).toMatch(
      /Defined in `src\/payments\/payment-events\.ts:\d+` as `PaymentCompleted`/,
    );
    expect(event?.['x-autocatalog']).toMatchObject({ provenance: { default: 'extracted' } });
  });

  it('indexes as an EventCatalog Federation source, through the same SDK call Federation makes', async () => {
    const index = await sdk.buildIndex({ source: 'payments', commit: 'test', hashContent: true });

    const keys = index.resources.map((resource) => `${resource.type}:${resource.id}`);

    expect(index.source).toBe('payments');
    expect(keys).toEqual(
      expect.arrayContaining([
        'event:payment.completed',
        'service:PaymentService',
        'domain:payments',
      ]),
    );
  });

  it('places a service with the events it produces', async () => {
    const service = await sdk.getService('PaymentService');
    expect(service?.sends?.map((pointer) => pointer.id)).toContain('payment.completed');
    const domain = await sdk.getDomain('payments');
    expect(domain?.services?.map((pointer) => pointer.id)).toContain('PaymentService');
  });

  it('carries deprecation, owners and examples across', async () => {
    const invoice = await sdk.getEvent('invoice.raised');
    expect(invoice?.deprecated).toEqual({
      date: '2026-05-01',
      message: 'Invoice settlement moved into the payments pipeline.',
    });
    expect(invoice?.owners).toEqual(['billing']);
    expect(await sdk.getTeam('billing')).toMatchObject({ id: 'billing', name: 'Billing' });

    const examples = await fs.readdir(
      path.join(catalog, 'domains/billing/events/invoice.raised/examples'),
    );

    expect(examples.length).toBeGreaterThan(0);
  });

  it('round-trips through from-eventcatalog without changing a contract', async () => {
    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const before = await loadCatalog(path.join(work, 'events'), { skipVersioned: true });
    const after = await loadCatalog(back, { skipVersioned: true });

    const contracts = (events: typeof before) =>
      Object.fromEntries(
        events.map((e) => [e.frontmatter.id, { version: e.frontmatter.version, schema: e.schema }]),
      );

    expect(contracts(after)).toEqual(contracts(before));
  });

  it('removes a domain that is no longer published, and keeps what autocatalog does not own', async () => {
    // A hand-written domain in the same EventCatalog project must survive.
    await sdk.writeDomain({
      id: 'hand-written',
      name: 'Hand written',
      version: '1.0.0',
      markdown: '',
    });

    // Retire the shipping contract in source and scan again, as the team would.
    const repoCopy = path.join(work, 'repo');
    await fs.cp(demoRepo, repoCopy, { recursive: true });
    await fs.rm(path.join(repoCopy, 'src/shipping'), { recursive: true });
    const { scanRepo } = await import('autocatalog-adapter-zod');
    const retired = path.join(work, 'events-after');
    await scanRepo({ root: repoCopy, out: retired });

    await exportRoots({ roots: [retired], catalogDir: catalog });
    expect(await sdk.getEvent('parcel.shipped')).toBeUndefined();
    expect(await sdk.getDomain('shipping')).toBeUndefined();
    expect(await sdk.getEvent('payment.completed')).toBeDefined();
    expect(await sdk.getDomain('hand-written')).toBeDefined();
  });
});

describe('provenanceLine', () => {
  it('says nothing when the contract has no recorded source', () => {
    // SAFETY: provenanceLine reads only frontmatter.source, provenance, confidence
    // and needsReview; the rest of LoadedEvent is never touched.
    const event = {
      frontmatter: { provenance: { default: 'declared', fields: {} }, needsReview: false },
    } as never;

    expect(provenanceLine(event)).toBeNull();
  });
});

describe('classification through EventCatalog', () => {
  let work: string;
  afterAll(() => fs.rm(work, { recursive: true, force: true }));

  it('exports it as a badge and reads it back as the field', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-classification-'));
    const folder = path.join(work, 'events/orders/OrderPlaced');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.placed',
        version: '1.0.0',
        name: 'Order Placed',
        summary: 's',
        domain: 'orders',
        classification: 'integration',
        badges: [{ content: 'Webhook' }],
      }),
    );
    await fs.writeFile(path.join(folder, 'schema.json'), '{ "type": "object" }');
    const catalog = path.join(work, 'catalog');
    await exportRoots({ roots: [path.join(work, 'events')], catalogDir: catalog });

    const event = await utils(catalog).getEvent('order.placed');
    expect(event?.badges?.map((badge) => badge.content)).toEqual([
      'Webhook',
      'classification: integration',
    ]);

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const [imported] = await loadCatalog(back);
    expect(imported?.frontmatter.classification).toBe('integration');
    expect(imported?.frontmatter.badges.map((badge) => badge.content)).toEqual(['Webhook']);
  });
});

describe('consumer field usage through EventCatalog', () => {
  let work: string;
  afterAll(() => fs.rm(work, { recursive: true, force: true }));

  it("exports it as the service's receives[].fields and reads it back", async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-consumer-fields-'));
    const folder = path.join(work, 'events/orders/OrderPlaced');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.placed',
        version: '1.0.0',
        name: 'Order Placed',
        summary: 's',
        domain: 'orders',
        consumers: ['Billing', 'Shipping'],
        consumerFields: { Billing: ['total'] },
      }),
    );
    await fs.writeFile(path.join(folder, 'schema.json'), '{ "type": "object" }');
    const catalog = path.join(work, 'catalog');
    await exportRoots({ roots: [path.join(work, 'events')], catalogDir: catalog });

    const sdk = utils(catalog);
    expect((await sdk.getService('Billing'))?.receives).toEqual([
      { id: 'order.placed', version: '1.0.0', fields: ['total'] },
    ]);
    expect((await sdk.getService('Shipping'))?.receives).toEqual([
      { id: 'order.placed', version: '1.0.0' },
    ]);

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const [imported] = await loadCatalog(back);
    expect(imported?.frontmatter.consumerFields).toEqual({ Billing: ['total'] });
  });
});

describe('transport through EventCatalog channels', () => {
  let work: string;
  afterAll(() => fs.rm(work, { recursive: true, force: true }));

  const writeEvent = async (
    id: string,
    folderName: string,
    transport: Array<{ address: string; protocols?: string[]; deliveryMode?: string }>,
    services: { producers?: string[]; consumers?: string[] } = {},
  ) => {
    const folder = path.join(work, 'events/orders', folderName);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id,
        version: '1.0.0',
        name: id,
        summary: 's',
        domain: 'orders',
        transport,
        ...services,
      }),
    );
    await fs.writeFile(path.join(folder, 'schema.json'), '{ "type": "object" }');
  };

  it('writes one channel per address, points each event at it, and reads it back', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-channels-'));
    await writeEvent(
      'order.placed',
      'OrderPlaced',
      [
        { address: 'orders.events', protocols: ['kafka'], deliveryMode: 'push' },
        { address: 'orders/{orderId}/audit', protocols: ['http'] },
      ],
      { producers: ['OrderService'], consumers: ['Billing'] },
    );
    await writeEvent('order.cancelled', 'OrderCancelled', [
      { address: 'orders.events', protocols: ['kafka'] },
    ]);
    const catalog = path.join(work, 'catalog');
    const roots = [path.join(work, 'events')];
    await exportRoots({ roots, catalogDir: catalog });

    const sdk = utils(catalog);
    const channels = await sdk.getChannels();
    expect(
      channels
        .map(({ id, address, protocols }) => ({ id, address, protocols }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      {
        id: 'orders-orderid-audit-eca779d5',
        address: 'orders/{orderId}/audit',
        protocols: ['http'],
      },
      { id: 'orders.events', address: 'orders.events', protocols: ['kafka'] },
    ]);

    // Where EventCatalog 4 keeps them: on the services that send and receive,
    // which its build otherwise migrates an event's own channels into.
    const pointers = [
      { id: 'orders.events', version: '1.0.0', delivery_mode: 'push' },
      { id: 'orders-orderid-audit-eca779d5', version: '1.0.0' },
    ];

    expect((await sdk.getService('OrderService'))?.sends).toEqual([
      { id: 'order.placed', version: '1.0.0', to: pointers },
    ]);
    expect((await sdk.getService('Billing'))?.receives).toEqual([
      { id: 'order.placed', version: '1.0.0', from: pointers },
    ]);
    expect((await sdk.getEvent('order.placed'))?.channels).toBeUndefined();
    // An event no service sends or receives keeps them itself.
    expect((await sdk.getEvent('order.cancelled'))?.channels).toEqual([
      { id: 'orders.events', version: '1.0.0' },
    ]);

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const imported = await loadCatalog(back);
    expect(
      imported.find((e) => e.frontmatter.id === 'order.placed')?.frontmatter.transport,
    ).toEqual([
      { address: 'orders.events', protocols: ['kafka'], deliveryMode: 'push' },
      { address: 'orders/{orderId}/audit', protocols: ['http'] },
    ]);

    // Owned like every other page: an address nobody uses any more goes.
    await fs.rm(path.join(work, 'events/orders/OrderPlaced'), { recursive: true });
    await exportRoots({ roots, catalogDir: catalog });
    expect((await utils(catalog).getChannels()).map((channel) => channel.id)).toEqual([
      'orders.events',
    ]);
  });

  it('keeps addresses that slug alike as separate channels', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-channels-'));
    await writeEvent('order.audited', 'OrderAudited', [
      { address: 'orders/{id}', protocols: ['http'] },
      { address: 'orders-id', protocols: ['kafka'] },
    ]);
    const catalog = path.join(work, 'catalog');
    await exportRoots({ roots: [path.join(work, 'events')], catalogDir: catalog });

    const channels = await utils(catalog).getChannels();
    expect(
      channels
        .map(({ id, address, protocols }) => ({ id, address, protocols }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      { id: 'orders-id', address: 'orders-id', protocols: ['kafka'] },
      { id: 'orders-id-ef7dbd91', address: 'orders/{id}', protocols: ['http'] },
    ]);

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const [imported] = await loadCatalog(back);
    expect(imported?.frontmatter.transport).toEqual([
      { address: 'orders/{id}', protocols: ['http'] },
      { address: 'orders-id', protocols: ['kafka'] },
    ]);
  });
  it('refuses a channel id collision before touching the previous export', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-channels-'));
    await writeEvent('order.audited', 'OrderAudited', [{ address: 'orders/{id}' }]);
    const catalog = path.join(work, 'catalog');
    const roots = [path.join(work, 'events')];
    await exportRoots({ roots, catalogDir: catalog });

    // A literal address that is the hashed id of another.
    await writeEvent('order.audited', 'OrderAudited', [
      { address: 'orders/{id}' },
      { address: 'orders-id-ef7dbd91' },
    ]);
    await expect(exportRoots({ roots, catalogDir: catalog })).rejects.toThrow(
      'Channel addresses orders/{id} and orders-id-ef7dbd91 both map to channel id orders-id-ef7dbd91',
    );
    expect(await utils(catalog).getEvent('order.audited')).toBeDefined();
  });
});

describe('repository content never becomes code or a path in the EventCatalog project', () => {
  let work: string;
  afterEach(() => fs.rm(work, { recursive: true, force: true }));

  async function event(manifest: { version?: string }, body = ''): Promise<string> {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-hostile-'));
    const folder = path.join(work, 'events/orders/OrderPlaced');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.placed',
        version: '1.0.0',
        name: 'Order Placed',
        summary: 's',
        domain: 'orders',
        ...manifest,
      }),
    );
    await fs.writeFile(path.join(folder, 'schema.json'), '{ "type": "object" }');

    if (body) await fs.writeFile(path.join(folder, 'index.mdx'), `---\n---\n${body}\n`);

    return path.join(work, 'events');
  }

  it('refuses a version that would climb out of the project, before writing anything', async () => {
    const roots = [await event({ version: '../../../escape' })];
    const catalog = path.join(work, 'catalog');

    await expect(exportRoots({ roots, catalogDir: catalog })).rejects.toThrow(
      'version "../../../escape" cannot be a path segment',
    );
    await expect(fs.access(catalog)).rejects.toThrow();
  });

  it('leaves narrative out unless asked, so a repository’s MDX never compiles here', async () => {
    const roots = [await event({}, 'Hello {process.exit(1)}')];
    const catalog = path.join(work, 'catalog');
    await exportRoots({ roots, catalogDir: catalog });
    expect((await utils(catalog).getEvent('order.placed'))?.markdown).not.toContain('process.exit');

    await exportRoots({ roots, catalogDir: catalog, narrative: true });
    expect((await utils(catalog).getEvent('order.placed'))?.markdown).toContain('Hello');
  });

  it('keeps a source path with backticks inside its code span', () => {
    // SAFETY: provenanceLine reads only frontmatter.source, provenance, confidence
    // and needsReview; the rest of LoadedEvent is never touched.
    const hostile = {
      frontmatter: {
        source: { type: 'code', file: 'a` {process.exit(1)} `b.ts' },
        provenance: { default: 'extracted', fields: {} },
        needsReview: false,
      },
    } as never;

    expect(provenanceLine(hostile)).toContain('``a` {process.exit(1)} `b.ts``');
  });
});

describe('delivery and example cases through EventCatalog', () => {
  let work: string;
  afterEach(() => fs.rm(work, { recursive: true, force: true }));

  const placed = { orderId: 'o1' };

  async function event(
    id: string,
    folderName: string,
    manifest: JsonObject,
    examples: Record<string, JsonValue> = {},
  ): Promise<void> {
    const folder = path.join(work, 'events/orders', folderName);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id,
        version: '1.0.0',
        name: id,
        summary: 's',
        domain: 'orders',
        ...manifest,
      }),
    );
    await fs.writeFile(
      path.join(folder, 'schema.json'),
      JSON.stringify({
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string' } },
      }),
    );

    for (const [file, data] of Object.entries(examples)) {
      const target = path.join(folder, 'examples', file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify(data));
    }
  }

  it('puts the guarantee on the channel, the cases in folders EventCatalog renders, and reads both back', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-delivery-'));

    const delivery = {
      guarantee: 'at-least-once',
      idempotencyKey: 'orderId',
      correlationKey: 'orderId',
      maxLateness: 'PT5M',
    };

    await event(
      'order.placed',
      'OrderPlaced',
      { transport: [{ address: 'orders.events', protocols: ['kafka'] }], delivery },
      {
        'placed.json': placed,
        'duplicate/redelivered.json': placed,
        'invalid/no-id.json': {},
      },
    );
    await event('order.cancelled', 'OrderCancelled', {
      transport: [{ address: 'orders.events' }],
      delivery: { guarantee: 'at-least-once' },
    });
    // An older version promised less; only what is current speaks for the channel.
    const history = path.join(work, 'events/orders/OrderCancelled/versioned/0.9.0');
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(
      path.join(history, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.cancelled',
        version: '0.9.0',
        name: 'order.cancelled',
        summary: 's',
        domain: 'orders',
        transport: [{ address: 'orders.events' }],
        delivery: { guarantee: 'at-most-once' },
      }),
    );
    await fs.writeFile(path.join(history, 'schema.json'), '{ "type": "object" }');

    // Two events that disagree leave their shared channel saying nothing.
    await event('order.audited', 'OrderAudited', {
      transport: [{ address: 'orders.audit' }],
      delivery: { guarantee: 'at-most-once' },
    });
    await event('order.flagged', 'OrderFlagged', {
      transport: [{ address: 'orders.audit' }],
      delivery: { guarantee: 'exactly-once' },
    });

    const catalog = path.join(work, 'catalog');
    await exportRoots({ roots: [path.join(work, 'events')], catalogDir: catalog });

    const sdk = utils(catalog);
    expect((await sdk.getChannel('orders.events'))?.deliveryGuarantee).toBe('at-least-once');
    expect((await sdk.getChannel('orders.audit'))?.deliveryGuarantee).toBeUndefined();

    const examples = path.join(catalog, 'domains/orders/events/order.placed/examples');
    expect(
      JSON.parse(await fs.readFile(path.join(examples, 'duplicate/redelivered.json'), 'utf8')),
    ).toEqual(placed);
    // EventCatalog's own metadata file names each case for its readers.
    expect(await fs.readFile(path.join(examples, 'examples.config.yaml'), 'utf8')).toContain(
      'summary: "Duplicate: a repeat consumers must recognise"',
    );

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const imported = (await loadCatalog(back)).find((e) => e.frontmatter.id === 'order.placed');

    expect(imported?.frontmatter.delivery).toEqual(delivery);
    expect(imported?.examples.map((e) => [e.name, e.case])).toEqual([
      ['redelivered', 'duplicate'],
      ['no-id', 'invalid'],
      ['placed', undefined],
    ]);
  });

  it('takes a guarantee from an EventCatalog channel the event travels on', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-native-'));
    const catalog = path.join(work, 'catalog');
    const sdk = utils(catalog);

    await sdk.writeChannel({
      id: 'orders.events',
      name: 'orders.events',
      version: '1.0.0',
      markdown: '',
      address: 'orders.events',
      deliveryGuarantee: 'at-least-once',
    });
    await sdk.writeEvent({
      id: 'order.placed',
      name: 'Order placed',
      version: '1.0.0',
      markdown: '',
      channels: [{ id: 'orders.events', version: '1.0.0' }],
    });
    await sdk.writeChannel({
      id: 'orders.audit',
      name: 'orders.audit',
      version: '1.0.0',
      markdown: '',
      address: 'orders.audit',
      deliveryGuarantee: 'at-most-once',
    });
    // On two channels that promise different things, it is promised neither.
    await sdk.writeEvent({
      id: 'order.audited',
      name: 'Order audited',
      version: '1.0.0',
      markdown: '',
      channels: [
        { id: 'orders.events', version: '1.0.0' },
        { id: 'orders.audit', version: '1.0.0' },
      ],
    });

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    expect(
      Object.fromEntries(
        (await loadCatalog(back)).map((e) => [e.frontmatter.id, e.frontmatter.delivery]),
      ),
    ).toEqual({ 'order.placed': { guarantee: 'at-least-once' }, 'order.audited': undefined });
  });

  it('reads an EventCatalog project’s examples.config.json as metadata, not a payload', async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-config-'));

    const catalog = path.join(work, 'catalog');

    await utils(catalog).writeEvent({
      id: 'order.placed',
      name: 'Order placed',
      version: '1.0.0',
      markdown: '',
    });

    const examples = path.join(catalog, 'events/order.placed/examples');
    await fs.mkdir(examples, { recursive: true });
    await fs.writeFile(path.join(examples, 'placed.json'), '{ "orderId": "o1" }');
    await fs.writeFile(
      path.join(examples, 'examples.config.json'),
      '{ "placed.json": { "name": "A placed order" } }',
    );

    const back = path.join(work, 'back');
    expect(await runFromEventCatalog({ source: catalog, out: back, quiet: true })).toBe(0);
    const [imported] = await loadCatalog(back);

    expect(imported?.examples.map((e) => e.name)).toEqual(['placed']);
    // Not copied across as a payload file either.
    expect(await fs.readdir(path.join(imported?.folder.path ?? '', 'examples'))).toEqual([
      'placed.json',
    ]);
  });
});
