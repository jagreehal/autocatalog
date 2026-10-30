import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import specs from '@asyncapi/specs';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCatalog, validateCatalog, type JsonObject, type JsonValue } from 'autocatalog-core';
import { runFromAsyncApi } from '../src/commands/from-asyncapi';
import { catalogToAsyncApi, runToAsyncApi } from '../src/commands/to-asyncapi';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-to-asyncapi-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const placedSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['orderId', 'meta', 'lines'],
  properties: {
    orderId: { type: 'string' },
    meta: { type: 'object', required: ['traceId'], properties: { traceId: { type: 'string' } } },
    // Zod and Pydantic both write shared types to $defs.
    lines: { type: 'array', items: { $ref: '#/$defs/Line' } },
  },
  $defs: {
    Line: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } },
  },
  // Contract-first schemas carry their metadata inline; it belongs on the message.
  'x-autocatalog': { id: 'order.placed' },
};

const placed = { orderId: 'o1', meta: { traceId: 't1' }, lines: [{ sku: 'a' }] };

async function event(
  folder: string,
  manifest: JsonObject,
  schema: JsonObject,
  examples: Record<string, JsonValue> = {},
): Promise<void> {
  const dir = path.join(tmp, 'events', folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'autocatalog.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, 'schema.json'), JSON.stringify(schema));

  for (const [file, data] of Object.entries(examples)) {
    const target = path.join(dir, 'examples', file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(data));
  }
}

async function catalog() {
  await event(
    'orders/OrderPlaced',
    {
      id: 'order.placed',
      version: '2.1.0',
      name: 'Order placed',
      summary: 'A customer placed an order.',
      domain: 'orders',
      owner: { team: 'Checkout' },
      producers: ['checkout'],
      consumers: ['billing', 'shipping'],
      transport: [{ address: 'orders.placed', protocols: ['kafka'] }],
      delivery: {
        guarantee: 'at-least-once',
        idempotencyKey: 'orderId',
        correlationKey: 'meta.traceId',
        maxLateness: 'PT5M',
      },
    },
    placedSchema,
    {
      'placed.json': placed,
      'duplicate/redelivered.json': placed,
      'invalid/no-lines.json': { orderId: 'o2', meta: { traceId: 't2' } },
    },
  );
  await event(
    'billing/InvoiceIssued',
    {
      id: 'invoice.issued',
      version: '1.0.0',
      name: 'Invoice issued',
      summary: 'An invoice went out.',
      domain: 'billing',
      producers: ['billing'],
    },
    { type: 'object', properties: { invoiceId: { type: 'string' } } },
  );

  return loadCatalog(path.join(tmp, 'events'));
}

const document = async (service?: string) =>
  catalogToAsyncApi(await catalog(), { title: 'Acme events', version: '1.0.0', service });

describe('catalogToAsyncApi', () => {
  it('writes a document the official AsyncAPI 3.0 schema accepts', async () => {
    // The official bundle carries its own copy of the draft-07 meta-schema.
    const validate = new Ajv({
      strict: false,
      allErrors: true,
      meta: false,
      validateSchema: false,
    }).compile(specs.schemas['3.0.0']);

    const doc = await document();

    expect(validate(doc) ? [] : validate.errors).toEqual([]);
  });

  it('describes each event as a message EventCatalog’s generator understands', async () => {
    const doc = await document();

    expect(doc).toMatchObject({
      asyncapi: '3.0.0',
      info: { title: 'Acme events', version: '1.0.0' },
      channels: {
        orders_placed: {
          address: 'orders.placed',
          messages: { orders_order_placed: { $ref: '#/components/messages/orders_order_placed' } },
          bindings: { kafka: {} },
        },
      },
      components: {
        messages: {
          orders_order_placed: {
            name: 'order.placed',
            title: 'Order placed',
            summary: 'A customer placed an order.',
            contentType: 'application/json',
            correlationId: { location: '$message.payload#/meta/traceId' },
            'x-eventcatalog-message-type': 'event',
            'x-eventcatalog-message-version': '2.1.0',
          },
        },
      },
    });
  });

  it('keeps the delivery promise and ownership, which AsyncAPI has no field for', async () => {
    const message = (await document()).components.messages.orders_order_placed!;

    expect(message['x-autocatalog']).toEqual({
      id: 'order.placed',
      version: '2.1.0',
      domain: 'orders',
      owner: { team: 'Checkout' },
      producers: ['checkout'],
      consumers: ['billing', 'shipping'],
      delivery: {
        guarantee: 'at-least-once',
        idempotencyKey: 'orderId',
        correlationKey: 'meta.traceId',
        maxLateness: 'PT5M',
      },
    });
  });

  it('offers mock servers every example except the invalid ones, which are not messages', async () => {
    const message = (await document()).components.messages.orders_order_placed!;

    expect(message.examples).toEqual([
      {
        // The case folder is part of the name: unique, and where EventCatalog's generator writes it.
        name: 'duplicate/redelivered',
        summary: 'Duplicate: a repeat consumers must recognise',
        payload: placed,
      },
      { name: 'placed', payload: placed },
    ]);
  });

  it('lifts $defs into components, so references still resolve inside the document', async () => {
    const doc = await document();
    const payload = doc.components.messages.orders_order_placed!.payload;

    expect(payload).toMatchObject({
      properties: { lines: { items: { $ref: '#/components/schemas/orders_order_placed_Line' } } },
    });
    expect(payload).not.toHaveProperty('$defs');
    expect(payload).not.toHaveProperty('$schema');
    expect(payload).not.toHaveProperty('x-autocatalog');
    expect(doc.components.schemas).toEqual({
      orders_order_placed_Line: {
        type: 'object',
        required: ['sku'],
        properties: { sku: { type: 'string' } },
      },
    });
  });

  it('sends every event from the catalog’s view, or one service’s sends and receives', async () => {
    const actions = (doc: Awaited<ReturnType<typeof document>>) =>
      Object.values(doc.operations)
        .map((op) => `${op.action} ${op.channel.$ref}`)
        .sort();

    expect(actions(await document())).toEqual([
      'send #/channels/invoice_issued',
      'send #/channels/orders_placed',
    ]);
    expect(actions(await document('billing'))).toEqual([
      'receive #/channels/orders_placed',
      'send #/channels/invoice_issued',
    ]);
    // A service's view leaves out what it neither sends nor receives.
    expect(Object.keys((await document('shipping')).channels)).toEqual(['orders_placed']);
  });
});

describe('commands', () => {
  it('refuses a commands folder it could not read', async () => {
    await catalog();

    const out = path.join(tmp, 'asyncapi.json');
    const missing = path.join(tmp, 'no-such-folder');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(
      await runToAsyncApi({ root: path.join(tmp, 'events'), commands: missing, out, quiet: true }),
    ).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain(`${missing}: directory could not be read`);
    await expect(fs.access(out)).rejects.toThrow();
    error.mockRestore();
  });

  it('writes a command with the queue its handler replies on, and leaves it out of an import', async () => {
    const folder = path.join(tmp, 'repo', 'commands', 'ReserveStock');

    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id: 'ReserveStock',
        version: '1.0.0',
        name: 'Reserve stock',
        summary: 'Hold stock for an order',
        domain: 'inventory',
        senders: ['checkout'],
        handler: 'inventory',
        transport: [{ address: 'stock.reserve' }],
        outcome: { type: 'result', schema: './reply.json', replyTo: 'stock.replies' },
      }),
    );
    await fs.writeFile(
      path.join(folder, 'schema.json'),
      JSON.stringify({ type: 'object', properties: { orderId: { type: 'string' } } }),
    );
    await fs.writeFile(
      path.join(folder, 'reply.json'),
      JSON.stringify({ type: 'object', properties: { reserved: { type: 'boolean' } } }),
    );
    await catalog();

    const out = path.join(tmp, 'asyncapi.json');

    await runToAsyncApi({
      root: path.join(tmp, 'events'),
      commands: path.join(tmp, 'repo'),
      out,
      service: 'checkout',
      quiet: true,
    });

    const doc = JSON.parse(await fs.readFile(out, 'utf8'));

    const validate = new Ajv({
      strict: false,
      allErrors: true,
      meta: false,
      validateSchema: false,
    }).compile(specs.schemas['3.0.0']);

    expect(validate(doc) ? [] : validate.errors).toEqual([]);
    const command = doc.components.messages.command_inventory_ReserveStock_1_0_0;

    expect(command['x-eventcatalog-message-type']).toBe('command');
    expect(doc.operations.send_stock_reserve_command_inventory_ReserveStock_1_0_0.reply).toEqual({
      channel: { $ref: '#/channels/stock_replies' },
      messages: [
        { $ref: '#/channels/stock_replies/messages/command_inventory_ReserveStock_1_0_0_reply' },
      ],
    });

    const imported = path.join(tmp, 'imported');

    expect(await runFromAsyncApi({ file: out, out: imported, quiet: true, strict: true })).toBe(0);
    expect((await loadCatalog(imported)).map((e) => e.frontmatter.id)).toEqual(['order.placed']);
  });
});

describe('commands beside events', () => {
  it('keeps a command apart from an event of the same name, and each version apart', async () => {
    await event(
      'orders/OrderPlaced',
      { id: 'place', version: '1.0.0', name: 'Place', summary: 's', domain: 'orders' },
      { type: 'object' },
    );

    const command = (version: string) => ({
      ref: { kind: 'command' as const, namespace: 'orders', id: 'place', version },
      title: 'Place',
      tags: [],
      provenance: { default: 'declared' as const, fields: {} },
      needsReview: false,
      attributes: {},
    });

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
      commands: {
        spec: 'autocatalog/graph-v1',
        resources: [command('1.0.0'), command('2.0.0')],
        relationships: [],
      },
    });

    expect(
      Object.values(doc.components.messages).map((m) => [
        m['x-eventcatalog-message-type'],
        m['x-eventcatalog-message-version'],
      ]),
    ).toEqual([
      ['event', '1.0.0'],
      ['command', '1.0.0'],
      ['command', '2.0.0'],
    ]);
  });
});

describe('importing a document with commands', () => {
  it('skips a message whose reference does not resolve, and imports the rest', async () => {
    const file = path.join(tmp, 'asyncapi.json');

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '3.0.0',
        info: { title: 'Shop', version: '1' },
        channels: {
          orders: {
            address: 'orders',
            messages: {
              placed: { name: 'order.placed', payload: { type: 'object' } },
              broken: { $ref: '#/components/messages/missing' },
            },
          },
        },
        operations: {
          send: { action: 'send', channel: { $ref: '#/channels/orders' } },
        },
      }),
    );

    const out = path.join(tmp, 'imported');

    expect(await runFromAsyncApi({ file, out, quiet: true })).toBe(0);
    expect((await loadCatalog(out)).map((e) => e.frontmatter.id)).toEqual(['order.placed']);
  });
  it('does the same in an AsyncAPI 2 document, for a missing and a circular reference', async () => {
    const file = path.join(tmp, 'asyncapi-2.json');

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '2.6.0',
        info: { title: 'Shop', version: '1' },
        channels: {
          orders: {
            subscribe: {
              message: {
                oneOf: [
                  { name: 'order.placed', payload: { type: 'object' } },
                  { $ref: '#/components/messages/missing' },
                  { $ref: '#/components/messages/loop' },
                ],
              },
            },
          },
        },
        components: { messages: { loop: { $ref: '#/components/messages/loop' } } },
      }),
    );

    const out = path.join(tmp, 'imported-2');

    expect(await runFromAsyncApi({ file, out, quiet: true })).toBe(0);
    expect((await loadCatalog(out)).map((e) => e.frontmatter.id)).toEqual(['order.placed']);
  });
});

describe('catalogToAsyncApi keys', () => {
  it('keeps events and channels apart when their names only differ in punctuation', async () => {
    for (const [folder, id, address] of [
      ['orders/A', 'order.placed', 'orders.placed'],
      ['orders/B', 'order_placed', 'orders/placed'],
      // Same address as the first: the same channel, carrying both.
      ['orders/C', 'order.repriced', 'orders.placed'],
    ] as const)
      await event(
        folder,
        {
          id,
          version: '1.0.0',
          name: id,
          summary: 's',
          domain: 'orders',
          transport: [{ address }],
        },
        { type: 'object' },
      );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
    });

    expect(
      Object.values(doc.components.messages)
        .map((m) => m.name)
        .sort(),
    ).toEqual(['order.placed', 'order.repriced', 'order_placed']);
    expect(
      Object.values(doc.channels)
        .map((c) => c.address)
        .sort(),
    ).toEqual(['orders.placed', 'orders/placed']);
    // A key only grows a suffix when it has to.
    expect(Object.keys(doc.channels[`orders_placed`]?.messages ?? {})).toHaveLength(2);
  });

  it('gives every message its own operation, however its channel and message keys run together', async () => {
    // send_x_b_a_b both ways if the keys were joined with underscores.
    for (const [domain, id, address] of [
      ['a', 'b', 'x_b'],
      ['b', 'a_b', 'x'],
    ] as const)
      await event(
        `${domain}/${id}`,
        { id, version: '1.0.0', name: id, summary: 's', domain, transport: [{ address }] },
        { type: 'object' },
      );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
    });

    expect(
      Object.values(doc.operations)
        .map((op) => op.messages[0]?.$ref)
        .sort(),
    ).toEqual(['#/channels/x/messages/b_a_b', '#/channels/x_b/messages/a_b']);
  });

  it('gives a service that sends and receives an event both operations', async () => {
    await event(
      'orders/A',
      {
        id: 'order.placed',
        version: '1.0.0',
        name: 'n',
        summary: 's',
        domain: 'orders',
        producers: ['orders'],
        consumers: ['orders'],
      },
      { type: 'object' },
    );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
      service: 'orders',
    });

    expect(
      Object.values(doc.operations)
        .map((op) => op.action)
        .sort(),
    ).toEqual(['receive', 'send']);
  });

  it('keeps two examples of the same name in different cases apart, and brings them back', async () => {
    await event(
      'orders/A',
      { id: 'order.placed', version: '1.0.0', name: 'n', summary: 's', domain: 'orders' },
      { type: 'object' },
      { 'sample.json': { a: 1 }, 'duplicate/sample.json': { a: 1 } },
    );

    const out = path.join(tmp, 'asyncapi.yaml');
    const imported = path.join(tmp, 'imported');

    await runToAsyncApi({ root: path.join(tmp, 'events'), out, quiet: true });
    expect(await runFromAsyncApi({ file: out, out: imported, quiet: true })).toBe(0);

    expect((await loadCatalog(imported))[0]?.examples.map((e) => [e.name, e.case])).toEqual([
      ['sample', 'duplicate'],
      ['sample', undefined],
    ]);
  });
});

describe('catalogToAsyncApi edge cases', () => {
  const validate = () =>
    new Ajv({ strict: false, allErrors: true, meta: false, validateSchema: false }).compile(
      specs.schemas['3.0.0'],
    );

  /** Export, then import, and return what came back, validated as a catalog. */
  async function roundTrip() {
    const out = path.join(tmp, 'asyncapi.yaml');
    const imported = path.join(tmp, 'imported');

    expect(await runToAsyncApi({ root: path.join(tmp, 'events'), out, quiet: true })).toBe(0);
    expect(await runFromAsyncApi({ file: out, out: imported, quiet: true })).toBe(0);

    const result = await validateCatalog(imported);
    expect(result.errors).toEqual([]);

    return result.events;
  }

  it('keeps events apart across domains whose names join the same way', async () => {
    await event(
      'sales/A',
      { id: 'eu_created', version: '1.0.0', name: 'a', summary: 's', domain: 'sales' },
      { type: 'object' },
    );
    await event(
      'sales_eu/B',
      { id: 'created', version: '1.0.0', name: 'b', summary: 's', domain: 'sales_eu' },
      { type: 'object' },
    );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
    });

    expect(
      Object.values(doc.components.messages)
        .map((m) => m.name)
        .sort(),
    ).toEqual(['created', 'eu_created']);
  });

  it('sends a structured CloudEvent as its envelope, and brings it back as data and envelope', async () => {
    const data: JsonObject = {
      type: 'object',
      required: ['orderId'],
      properties: { orderId: { type: 'string' }, correlationId: { type: 'string' } },
    };

    const envelope = {
      specversion: '1.0',
      id: 'e1',
      source: '/orders',
      type: 'order.placed',
      data: { orderId: 'o1' },
    };

    await event(
      'orders/A',
      {
        id: 'order.placed',
        version: '1.0.0',
        name: 'n',
        summary: 's',
        domain: 'orders',
        envelope: { type: 'cloudevents', mode: 'structured' },
      },
      data,
      { 'placed.json': envelope },
    );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
    });

    const message = doc.components.messages.orders_order_placed;
    const check = validate();

    expect(check(doc) ? [] : check.errors).toEqual([]);
    expect(message?.payload).toMatchObject({
      required: ['specversion', 'id', 'source', 'type'],
      properties: { data },
    });
    expect(message?.examples?.[0]?.payload).toEqual(envelope);
    // The event is the envelope's data, so that is where its correlation id is.
    expect(message?.correlationId).toEqual({ location: '$message.payload#/data/correlationId' });

    const [back] = await roundTrip();

    expect(back?.frontmatter.envelope).toEqual({
      type: 'cloudevents',
      mode: 'structured',
      specversion: '1.0',
    });
    expect(back?.schema).toEqual(data);
    expect(back?.examples.map((e) => e.data)).toEqual([envelope]);
  });

  it('keeps a reference to the payload’s own root, and a definition that is a boolean', async () => {
    const tree: JsonObject = {
      type: 'object',
      properties: {
        children: { type: 'array', items: { $ref: '#' } },
        never: { $ref: '#/$defs/Never' },
        siblings: { $ref: '#/properties/children' },
        extra: { $ref: '#/$defs/Anything' },
      },
      $defs: { Never: false, Anything: true },
    };

    await event(
      'tree/A',
      { id: 'node.added', version: '1.0.0', name: 'n', summary: 's', domain: 'tree' },
      tree,
    );

    const doc = catalogToAsyncApi(await loadCatalog(path.join(tmp, 'events')), {
      title: 't',
      version: '1',
    });

    const check = validate();

    expect(check(doc) ? [] : check.errors).toEqual([]);
    // In the document `#` is the document; the payload's root has to be named.
    expect(doc.components.messages.tree_node_added?.payload).toEqual({
      $ref: '#/components/schemas/tree_node_added',
    });
    expect(doc.components.schemas).toMatchObject({
      tree_node_added: {
        properties: {
          children: { items: { $ref: '#/components/schemas/tree_node_added' } },
          siblings: { $ref: '#/components/schemas/tree_node_added/properties/children' },
        },
      },
      // AsyncAPI wants an object here; this one matches nothing, as `false` does.
      tree_node_added_Never: { not: {} },
      tree_node_added_Anything: {},
    });

    const [back] = await roundTrip();

    expect(back?.schema).toEqual(tree);
  });
});

describe('ac from-asyncapi, identity and references', () => {
  it('keeps events with the same id in different domains apart, each with its own channel', async () => {
    for (const domain of ['billing', 'sales'])
      await event(
        `${domain}/Created`,
        {
          id: 'created',
          version: '1.0.0',
          name: `${domain} created`,
          summary: 's',
          domain,
          transport: [{ address: `${domain}.created` }],
        },
        { type: 'object' },
      );

    const out = path.join(tmp, 'asyncapi.yaml');
    const imported = path.join(tmp, 'imported');

    await runToAsyncApi({ root: path.join(tmp, 'events'), out, quiet: true });
    expect(await runFromAsyncApi({ file: out, out: imported, quiet: true })).toBe(0);

    expect(
      (await loadCatalog(imported))
        .map((e) => [
          e.frontmatter.domain,
          e.frontmatter.id,
          e.frontmatter.transport?.map((t) => t.address),
        ])
        .sort(),
    ).toEqual([
      ['billing', 'created', ['billing.created']],
      ['sales', 'created', ['sales.created']],
    ]);
  });

  it('keeps two versions of one event: the newest current, the older as its history', async () => {
    const file = path.join(tmp, 'asyncapi.json');

    const message = (version: string) => ({
      name: 'order.placed',
      payload: { type: 'object' },
      'x-eventcatalog-message-version': version,
    });

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '3.0.0',
        info: { title: 'Shop', version: '1.0.0' },
        channels: {
          v1: { address: 'orders.v1', messages: { a: { $ref: '#/components/messages/a' } } },
          v2: { address: 'orders.v2', messages: { b: { $ref: '#/components/messages/b' } } },
        },
        operations: {
          s1: { action: 'send', channel: { $ref: '#/channels/v1' } },
          s2: { action: 'send', channel: { $ref: '#/channels/v2' } },
        },
        // The older one second, so order in the document decides nothing.
        components: { messages: { b: message('2.0.0'), a: message('1.10.0') } },
      }),
    );

    expect(await runFromAsyncApi({ file, out: path.join(tmp, 'out'), quiet: true })).toBe(0);
    expect(
      (await loadCatalog(path.join(tmp, 'out')))
        .map((e) => [
          e.frontmatter.version,
          e.folder.isVersioned,
          e.frontmatter.transport?.map((t) => t.address),
        ])
        .sort(),
    ).toEqual([
      ['1.10.0', true, ['orders.v1']],
      ['2.0.0', false, ['orders.v2']],
    ]);
  });

  it('reads a component that shares the message’s name as a definition, not the payload itself', async () => {
    const file = path.join(tmp, 'asyncapi.json');

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '3.0.0',
        info: { title: 'Accounts', version: '1.0.0' },
        channels: {
          users: { address: 'users', messages: { User: { $ref: '#/components/messages/User' } } },
        },
        operations: { sendUser: { action: 'send', channel: { $ref: '#/channels/users' } } },
        components: {
          messages: {
            User: {
              name: 'user.registered',
              payload: {
                type: 'object',
                properties: { user: { $ref: '#/components/schemas/User' } },
              },
            },
          },
          schemas: {
            User: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          },
        },
      }),
    );

    expect(await runFromAsyncApi({ file, out: path.join(tmp, 'out'), quiet: true })).toBe(0);
    expect((await loadCatalog(path.join(tmp, 'out')))[0]?.schema).toEqual({
      type: 'object',
      properties: { user: { $ref: '#/$defs/User' } },
      $defs: { User: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    });
  });
});

describe('ac from-asyncapi, example names', () => {
  it('reads an example named after a case as just a name', async () => {
    const file = path.join(tmp, 'asyncapi.json');

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '3.0.0',
        info: { title: 'Shop', version: '1.0.0' },
        channels: {
          orders: {
            address: 'orders',
            messages: { placed: { $ref: '#/components/messages/placed' } },
          },
        },
        operations: { sendPlaced: { action: 'send', channel: { $ref: '#/channels/orders' } } },
        components: {
          messages: {
            placed: {
              name: 'order.placed',
              payload: { type: 'object' },
              examples: [
                { name: 'empty', payload: {} },
                { name: 'late/after-outage', payload: {} },
                // A folder that is not a case cannot be a file name either.
                { name: 'regional/eu', payload: {} },
              ],
            },
          },
        },
      }),
    );

    expect(await runFromAsyncApi({ file, out: path.join(tmp, 'out'), quiet: true })).toBe(0);
    expect(
      (await loadCatalog(path.join(tmp, 'out')))[0]?.examples.map((e) => [e.name, e.case]),
    ).toEqual([
      ['empty', undefined],
      ['after-outage', 'late'],
      ['regional-eu', undefined],
    ]);
  });
});

describe('ac to-asyncapi', () => {
  it('writes YAML or JSON by the file’s extension', async () => {
    await catalog();

    for (const file of ['asyncapi.yaml', 'asyncapi.json']) {
      const out = path.join(tmp, file);

      expect(await runToAsyncApi({ root: path.join(tmp, 'events'), out, quiet: true })).toBe(0);

      const text = await fs.readFile(out, 'utf8');
      const doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);

      expect(doc.asyncapi).toBe('3.0.0');
    }
  });

  it('names the services there are when asked for one that is not', async () => {
    await catalog();

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(line));

    try {
      const exit = await runToAsyncApi({
        root: path.join(tmp, 'events'),
        out: path.join(tmp, 'x.yaml'),
        service: 'biling',
        quiet: true,
      });

      expect(exit).toBe(1);
      expect(errors.join('\n')).toContain('Services in this catalog: billing, checkout, shipping');
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses, in a sentence, two schemas that would share one component', async () => {
    // x/a's definition `b` and x/a_b's own root both want `x_a_b`.
    await event(
      'x/A',
      { id: 'a', version: '1.0.0', name: 'a', summary: 's', domain: 'x' },
      {
        type: 'object',
        properties: { b: { $ref: '#/$defs/b' } },
        $defs: { b: { type: 'string' } },
      },
    );
    await event(
      'x/AB',
      { id: 'a_b', version: '1.0.0', name: 'ab', summary: 's', domain: 'x' },
      { type: 'object', properties: { self: { $ref: '#' } } },
    );

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(line));

    try {
      const exit = await runToAsyncApi({
        root: path.join(tmp, 'events'),
        out: path.join(tmp, 'x.yaml'),
        quiet: true,
      });

      expect(exit).toBe(1);
      expect(errors.join('\n')).toContain('Schema component x_a_b is claimed twice');
    } finally {
      spy.mockRestore();
    }
  });

  it('comes back through ac from-asyncapi as the same catalog', async () => {
    const before = await catalog();
    const out = path.join(tmp, 'asyncapi.yaml');
    const imported = path.join(tmp, 'imported');

    await runToAsyncApi({ root: path.join(tmp, 'events'), out, quiet: true });
    expect(await runFromAsyncApi({ file: out, out: imported, quiet: true })).toBe(0);

    const after = await loadCatalog(imported);

    // What a round trip must keep; $schema and inline metadata move to the message.
    const kept = (events: typeof before) =>
      events
        .map((e) => ({
          id: e.frontmatter.id,
          version: e.frontmatter.version,
          domain: e.frontmatter.domain,
          owner: e.frontmatter.owner,
          producers: e.frontmatter.producers,
          consumers: e.frontmatter.consumers,
          delivery: e.frontmatter.delivery,
          schema: Object.fromEntries(
            Object.entries(e.schema).filter(
              ([key]) => key !== '$schema' && key !== 'x-autocatalog',
            ),
          ),
          examples: e.examples
            .filter((x) => x.case !== 'invalid')
            .map((x) => ({ name: x.name, case: x.case, data: x.data })),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(kept(after)).toEqual(kept(before));
  });
});

describe('ac from-asyncapi, reading what others write', () => {
  it('takes each message’s version from EventCatalog’s extension over the document’s', async () => {
    const file = path.join(tmp, 'asyncapi.json');

    await fs.writeFile(
      file,
      JSON.stringify({
        asyncapi: '3.0.0',
        info: { title: 'Shop', version: '9.9.9' },
        channels: {
          orders: {
            address: 'orders',
            messages: { placed: { $ref: '#/components/messages/placed' } },
          },
        },
        operations: {
          sendPlaced: { action: 'send', channel: { $ref: '#/channels/orders' } },
        },
        components: {
          messages: {
            placed: {
              name: 'order.placed',
              payload: { type: 'object' },
              'x-eventcatalog-message-version': '3.2.0',
            },
          },
        },
      }),
    );

    expect(await runFromAsyncApi({ file, out: path.join(tmp, 'out'), quiet: true })).toBe(0);
    expect((await loadCatalog(path.join(tmp, 'out')))[0]?.frontmatter.version).toBe('3.2.0');
  });
});
