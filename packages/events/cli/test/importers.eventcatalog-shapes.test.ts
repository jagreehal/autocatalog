import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  driftResources,
  emptyResourceGraph,
  loadCatalog,
  parseResourceGraph,
  scanArchitecture,
} from 'autocatalog-core';
import { runFromEventCatalog } from '../src/commands/from-eventcatalog';

// Shapes taken from EventCatalog's own example catalog: events that declare a
// schemaPath other than schema.json, and history kept under versioned/ by every
// kind of resource, not only events.

let dir: string;

let out: string;

let said: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-shapes-'));
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-shapes-out-'));
  said = [];

  for (const stream of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(out, { recursive: true, force: true });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(dir, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const doc = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n\nBody.\n`;

const avro = JSON.stringify({
  type: 'record',
  name: 'InventoryAdjusted',
  fields: [
    { name: 'sku', type: 'string' },
    { name: 'delta', type: 'int' },
  ],
});

async function load() {
  const events = await loadCatalog(out);

  return new Map(events.map((e) => [`${e.frontmatter.id}@${e.frontmatter.version}`, e] as const));
}

describe('from-eventcatalog: the declared schemaPath', () => {
  it('reads the declared Avro contract, not a schema.json lying beside it', async () => {
    await write(
      'events/InventoryAdjusted/index.md',
      doc({ id: 'InventoryAdjusted', version: '1.0.1', schemaPath: "'schema.avro'" }),
    );
    await write('events/InventoryAdjusted/schema.avro', avro);
    await write(
      'events/InventoryAdjusted/schema.json',
      JSON.stringify({ type: 'object', title: 'Something else entirely' }),
    );

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);

    const event = (await load()).get('InventoryAdjusted@1.0.1')!;
    expect(Object.keys(event.schema.properties ?? {}).sort()).toEqual(['delta', 'sku']);
    expect(event.schema.title).not.toBe('Something else entirely');
  });

  it('translates a protobuf contract, choosing the message named after the event', async () => {
    await write(
      'events/OrderPlaced/index.md',
      doc({ id: 'OrderPlaced', name: 'OrderPlaced', version: '1.0.0', schemaPath: 'orders.proto' }),
    );
    await write(
      'events/OrderPlaced/orders.proto',
      'syntax = "proto3";\nmessage OrderPlaced { string order_id = 1; }\nmessage Unrelated { int32 n = 1; }\n',
    );

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);

    const event = (await load()).get('OrderPlaced@1.0.0')!;
    expect(Object.keys(event.schema.properties ?? {})).toEqual(['order_id']);
  });

  it('skips a declared contract it cannot read or translate, and says which and why', async () => {
    await write('events/Kept/index.md', doc({ id: 'Kept', version: '1.0.0' }));
    await write('events/Kept/schema.json', JSON.stringify({ type: 'object' }));
    await write(
      'events/Missing/index.md',
      doc({ id: 'Missing', version: '1.0.0', schemaPath: 'nowhere.avsc' }),
    );
    await write(
      'events/Graph/index.md',
      doc({ id: 'Graph', version: '1.0.0', schemaPath: 'schema.graphql' }),
    );
    await write('events/Graph/schema.graphql', 'type Query { ok: Boolean }');
    await write(
      'events/Escape/index.md',
      doc({ id: 'Escape', version: '1.0.0', schemaPath: '../../../etc/passwd.json' }),
    );

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);

    const text = said.join('\n');
    expect(text).toMatch(/Missing@1\.0\.0: .*nowhere\.avsc does not exist/);
    expect(text).toMatch(/Graph@1\.0\.0: .*\.graphql schema format is not supported/);
    expect(text).toMatch(/Escape@1\.0\.0: schemaPath .* points outside the catalog/);
    // None of them became a placeholder that looks like a real contract.
    expect([...(await load()).keys()]).toEqual(['Kept@1.0.0']);
  });
});

describe('from-eventcatalog: history belongs to the resource that owns it', () => {
  it('imports event history, and no service, domain, command or flow history as events', async () => {
    await write(
      'events/PaymentAccepted/index.md',
      doc({ id: 'PaymentAccepted', version: '2.0.0' }),
    );
    await write('events/PaymentAccepted/schema.json', JSON.stringify({ type: 'object' }));
    await write(
      'events/PaymentAccepted/versioned/1.0.0/index.md',
      doc({ id: 'PaymentAccepted', version: '1.0.0' }),
    );
    await write(
      'events/PaymentAccepted/versioned/1.0.0/schema.json',
      JSON.stringify({ type: 'object' }),
    );

    // Every other kind of resource keeps history the same way. None of it is
    // event history, including a flow that shares the event's id.
    await write(
      'services/PaymentService/index.md',
      doc({ id: 'PaymentService', version: '0.0.2' }),
    );
    await write(
      'services/PaymentService/versioned/0.0.1/index.md',
      doc({ id: 'PaymentService', version: '0.0.1' }),
    );
    await write(
      'domains/Payment/versioned/0.0.1/index.md',
      doc({ id: 'Payment', version: '0.0.1' }),
    );
    await write(
      'commands/AddInventory/versioned/0.0.1/index.md',
      doc({ id: 'AddInventory', version: '0.0.1' }),
    );
    await write(
      'services/PaymentService/flows/PaymentAccepted/versioned/0.0.1/index.md',
      doc({ id: 'PaymentAccepted', version: '0.0.1' }),
    );

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);

    const all = await loadCatalog(out);
    expect(all.map((e) => `${e.frontmatter.id}@${e.frontmatter.version}`).sort()).toEqual([
      'PaymentAccepted@1.0.0',
      'PaymentAccepted@2.0.0',
    ]);
  });
});

describe('from-eventcatalog: build output', () => {
  it('skips dist/ and federated/ so no event is imported twice', async () => {
    await write('events/OrderPlaced/index.md', doc({ id: 'OrderPlaced', version: '1.0.0' }));
    await write('dist/events/OrderPlaced/index.md', doc({ id: 'OrderPlaced', version: '9.0.0' }));
    await write(
      'federated/events/OrderPlaced/index.md',
      doc({ id: 'OrderPlaced', version: '8.0.0' }),
    );

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);

    expect([...(await load()).keys()]).toEqual(['OrderPlaced@1.0.0']);
  });
});

describe('from-eventcatalog: commands and queries', () => {
  it('imports each as a command, sent by the services that send it and handled by the one that receives it', async () => {
    await write(
      'domains/Orders/commands/PlaceOrder/index.md',
      doc({
        id: 'PlaceOrder',
        version: '1.2.0',
        name: 'Place order',
        summary: 'Asks for an order.',
      }),
    );
    await write(
      'domains/Orders/commands/PlaceOrder/schema.json',
      JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }),
    );
    await write(
      'domains/Orders/queries/GetOrder/index.md',
      doc({ id: 'GetOrder', version: '0.1.0', summary: 'Reads an order.' }),
    );
    await write(
      'domains/Orders/services/Web/index.md',
      `---\nid: Web\nversion: 1.0.0\nsends:\n  - id: PlaceOrder\n  - id: GetOrder\n---\n`,
    );
    await write(
      'domains/Orders/services/OrderService/index.md',
      `---\nid: OrderService\nversion: 1.0.0\nreceives:\n  - id: PlaceOrder\n  - id: GetOrder\n---\n`,
    );
    // A command's history is not a second command.
    await write(
      'domains/Orders/commands/PlaceOrder/versioned/1.0.0/index.md',
      doc({ id: 'PlaceOrder', version: '1.0.0' }),
    );

    expect(
      await runFromEventCatalog({
        source: dir,
        out: path.join(out, 'events'),
        cwd: out,
        quiet: true,
      }),
    ).toBe(0);

    const { graph, errors } = await scanArchitecture({ root: out, publish: false });
    expect(errors).toEqual([]);

    // EventCatalog says nothing of what a command produces, so no outcome is
    // claimed and ac resources drift asks for one; a query returns a result.
    expect(graph.resources.filter((r) => r.ref.kind === 'command')).toMatchObject([
      {
        ref: { kind: 'command', namespace: 'orders', id: 'GetOrder', version: '0.1.0' },
        title: 'GetOrder',
        attributes: { outcome: { type: 'result' } },
        tags: ['query'],
      },
      {
        ref: { kind: 'command', namespace: 'orders', id: 'PlaceOrder', version: '1.2.0' },
        title: 'Place order',
        attributes: { outcome: null },
        tags: [],
      },
    ]);

    const edges = graph.relationships.map((e) => `${e.from.id} ${e.type} ${e.to.id}`).sort();

    expect(edges).toEqual([
      'OrderService handles GetOrder',
      'OrderService handles PlaceOrder',
      'Web sends GetOrder',
      'Web sends PlaceOrder',
    ]);
  });

  it('leaves the handler out, and says so, when several services receive a command', async () => {
    await write('commands/PlaceOrder/index.md', doc({ id: 'PlaceOrder', version: '1.0.0' }));

    for (const service of ['A', 'B'])
      await write(
        `services/${service}/index.md`,
        `---\nid: ${service}\nversion: 1.0.0\nreceives:\n  - id: PlaceOrder\n---\n`,
      );

    await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), cwd: out });

    expect(said.join('\n')).toContain('PlaceOrder');
    expect(said.join('\n')).toContain('A, B receive it');

    const manifest = JSON.parse(
      await fs.readFile(
        path.join(out, 'commands/eventcatalog/placeorder/PlaceOrder/autocatalog.json'),
        'utf8',
      ),
    );

    expect(manifest.handler).toBeUndefined();
  });
});

describe('from-eventcatalog: services and the datastores they use', () => {
  it('imports services, containers and their reads and writes, so drift sees cross-team access', async () => {
    await write(
      'domains/Orders/services/OrderService/index.md',
      [
        '---',
        'id: OrderService',
        'name: Order Service',
        'version: 1.0.0',
        'summary: Takes orders.',
        'owners:',
        '  - id: orders-team',
        '    collection: teams',
        'repository:',
        '  url: https://github.com/acme/orders',
        'writesTo:',
        '  - id: orders-db',
        'readsFrom:',
        '  - id: ledger',
        '---',
        '',
      ].join('\n'),
    );
    await write(
      'containers/orders-db/index.md',
      doc({ id: 'orders-db', name: 'Orders DB', version: '1.0.0', owners: '[orders-team]' }),
    );
    await write(
      'containers/ledger/index.md',
      doc({
        id: 'ledger',
        name: 'Ledger',
        version: '1.0.0',
        technology: 'mongodb',
        owners: '[finance]',
      }),
    );
    // History is not a second service or datastore.
    await write(
      'domains/Orders/services/OrderService/versioned/0.1.0/index.md',
      doc({ id: 'OrderService', version: '0.1.0', owners: '[someone-else]' }),
    );

    expect(
      await runFromEventCatalog({
        source: dir,
        out: path.join(out, 'events'),
        cwd: out,
        quiet: true,
      }),
    ).toBe(0);

    const { graph, errors } = await scanArchitecture({ root: out, publish: false });
    expect(errors).toEqual([]);

    expect(graph.resources.filter((r) => r.ref.kind !== 'repository')).toMatchObject([
      {
        ref: { kind: 'collection', namespace: 'eventcatalog', id: 'ledger' },
        title: 'Ledger',
        owner: { team: 'finance' },
      },
      {
        ref: { kind: 'service', id: 'Order Service' },
        summary: 'Takes orders.',
        owner: { team: 'orders-team' },
        attributes: { domains: ['orders'], repository: 'https://github.com/acme/orders' },
      },
      {
        ref: { kind: 'table', namespace: 'eventcatalog', id: 'orders-db' },
        title: 'Orders DB',
        owner: { team: 'orders-team' },
      },
    ]);

    // A service outside any domain folder takes the domain that lists it. A
    // repository that is not a web address is not a link anyone can follow.
    await write(
      'services/Billing/index.md',
      `---\nid: Billing\nversion: 1.0.0\nrepository:\n  url: ssh://git@github.com/acme/billing.git\n---\n`,
    );
    await write(
      'domains/Finance/index.md',
      `---\nid: Finance\nversion: 1.0.0\nservices:\n  - id: Billing\n---\n`,
    );
    await runFromEventCatalog({
      source: dir,
      out: path.join(out, 'events'),
      cwd: out,
      quiet: true,
    });

    const rescanned = await scanArchitecture({ root: out, publish: false });

    expect(
      rescanned.graph.resources.find((r) => r.ref.kind === 'service' && r.ref.id === 'Billing'),
    ).toMatchObject({ attributes: { domains: ['finance'] } });
    expect(
      rescanned.graph.resources.find((r) => r.ref.kind === 'service' && r.ref.id === 'Billing')
        ?.attributes,
    ).not.toHaveProperty('repository');

    // A resource's url is its page on the site; a repository is not one.
    expect(graph.resources.find((r) => r.ref.kind === 'service')?.url).toBeUndefined();

    // Reading finance's ledger is the access the gate exists to catch.
    expect(
      driftResources(emptyResourceGraph(), graph)
        .filter((f) => f.code === 'cross_owner_access')
        .map((f) => f.message),
    ).toEqual([
      'Order Service (orders-team) reads collection eventcatalog/ledger, which finance owns',
    ]);
  });
});

describe('from-eventcatalog: what has no place in autocatalog', () => {
  it('names each kind of document it left behind, and how many', async () => {
    await write('events/Paid/index.md', doc({ id: 'Paid', version: '1.0.0' }));
    // A domain is imported: it files its services.
    await write('domains/Shop/index.md', doc({ id: 'Shop', version: '1.0.0' }));
    await write('domains/Shop/entities/Order/index.md', doc({ id: 'Order', version: '1.0.0' }));
    await write('domains/Shop/entities/Cart/index.md', doc({ id: 'Cart', version: '1.0.0' }));
    await write('flows/Checkout/index.md', doc({ id: 'Checkout', version: '1.0.0' }));
    await write('teams/payments.md', doc({ id: 'payments', name: 'Payments' }));
    // Prose examples are part of the message they sit in, not documents of their own.
    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write('commands/Pay/examples/index.mdx', '## Paying\n');
    // History of a resource that is imported is not a loss worth naming.
    await write('services/Shop/versioned/0.1.0/index.md', doc({ id: 'Shop', version: '0.1.0' }));

    expect(
      await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), cwd: out }),
    ).toBe(0);

    const told = said.join('\n');

    expect(told).toContain('Not imported: entities (2), flows (1), teams (1)');
    expect(told).not.toContain('versioned');
  });
});

describe('from-eventcatalog: services that share a name', () => {
  it('merges them, as their events already do, and says so', async () => {
    for (const [id, container] of [
      ['ShippingAPI', 'parcels'],
      ['CarrierShippingAPI', 'carriers'],
    ])
      await write(
        `services/${id}/index.md`,
        `---\nid: ${id}\nname: Shipping API\nversion: 1.0.0\nwritesTo:\n  - id: ${container}\n  - id: shared\n---\n`,
      );

    expect(
      await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), cwd: out }),
    ).toBe(0);

    const { graph, errors } = await scanArchitecture({ root: out, publish: false });
    expect(errors).toEqual([]);
    expect(graph.relationships.map((e) => `${e.from.id} ${e.type} ${e.to.id}`).sort()).toEqual([
      'Shipping API writes carriers',
      'Shipping API writes parcels',
      'Shipping API writes shared',
    ]);
    expect(said.join('\n')).toContain(
      'CarrierShippingAPI and ShippingAPI are both named Shipping API',
    );
  });
});

describe('from-eventcatalog: what to do next', () => {
  it('names everything to commit, and the scan that applies the services', async () => {
    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write(
      'services/Till/index.md',
      `---\nid: Till\nversion: 1.0.0\nwritesTo:\n  - id: sales\n---\n`,
    );

    await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), cwd: out });

    const told = said.join('\n');

    expect(told).toContain(
      `Commit ${path.join(out, 'commands', 'eventcatalog')} and ${path.join(out, '.autocatalog', 'imports')}`,
    );
    expect(told).toContain('ac resources scan');
  });
});

describe('from-eventcatalog: where the project is', () => {
  it('is the folder the events go into, unless --cwd says otherwise', async () => {
    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write(
      'services/Till/index.md',
      `---\nid: Till\nversion: 1.0.0\nwritesTo:\n  - id: sales\n---\n`,
    );

    const project = path.join(out, 'shop');

    // No events, so no events folder: the rest still lands beside where it would be.
    await runFromEventCatalog({ source: dir, out: path.join(project, 'events'), quiet: true });

    expect((await fs.readdir(project)).sort()).toEqual(['.autocatalog', 'commands']);
  });
});

describe('from-eventcatalog: importing again', () => {
  it('leaves nothing behind that the catalog no longer has', async () => {
    const project = { source: dir, out: path.join(out, 'events'), cwd: out, quiet: true };

    await write('events/Paid/index.md', doc({ id: 'Paid', version: '1.0.0' }));
    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write(
      'services/Till/index.md',
      `---\nid: Till\nversion: 1.0.0\nwritesTo:\n  - id: sales\n---\n`,
    );
    // Someone's own command, beside the imported ones, is theirs to keep.
    await fs.mkdir(path.join(out, 'commands/billing/Refund'), { recursive: true });
    await fs.writeFile(path.join(out, 'commands/billing/Refund/autocatalog.json'), '{}');

    await runFromEventCatalog(project);
    await fs.rm(path.join(dir, 'commands'), { recursive: true });
    await fs.rm(path.join(dir, 'services'), { recursive: true });
    expect(await runFromEventCatalog(project)).toBe(0);

    const left = await fs.readdir(out, { recursive: true });

    expect(left.filter((file) => /Pay|Till|sales|eventcatalog|staging/.test(file))).toEqual([]);
    expect(left).toContain(path.join('commands', 'billing', 'Refund', 'autocatalog.json'));
  });
});

describe('from-eventcatalog: a failed import changes nothing', () => {
  it('keeps the commands and services the last import wrote', async () => {
    const project = { source: dir, out: path.join(out, 'events'), cwd: out, quiet: true };

    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write(
      'services/Till/index.md',
      `---\nid: Till\nversion: 1.0.0\nwritesTo:\n  - id: sales\n---\n`,
    );
    expect(await runFromEventCatalog(project)).toBe(0);

    // Now the only command declares a schema that is not there, and nothing else imports.
    await fs.rm(path.join(dir, 'services'), { recursive: true });
    await write(
      'commands/Pay/index.md',
      doc({ id: 'Pay', version: '1.0.0', schemaPath: 'missing.json' }),
    );
    expect(await runFromEventCatalog(project)).toBe(1);

    const left = await fs.readdir(out, { recursive: true });

    expect(left).toContain(path.join('commands', 'eventcatalog', 'pay', 'Pay', 'autocatalog.json'));
    expect(left).toContain(path.join('.autocatalog', 'imports', 'eventcatalog.json'));
    // Nothing staged is left lying around.
    expect(left.filter((file) => file.startsWith(path.join('.autocatalog', 'staging')))).toEqual(
      [],
    );
  });
});

describe('from-eventcatalog: the channels a command declares', () => {
  it('become its transport', async () => {
    await write(
      'commands/Pay/index.md',
      `---\nid: Pay\nversion: 1.0.0\nchannels:\n  - id: payments\n---\n`,
    );
    await write(
      'channels/payments/index.md',
      `---\nid: payments\nversion: 1.0.0\naddress: payments.v1\nprotocols:\n  - kafka\n---\n`,
    );

    await runFromEventCatalog({
      source: dir,
      out: path.join(out, 'events'),
      cwd: out,
      quiet: true,
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(out, 'commands/eventcatalog/pay/Pay/autocatalog.json'), 'utf8'),
    );

    expect(manifest.transport).toEqual([{ address: 'payments.v1', protocols: ['kafka'] }]);
  });
});

describe('from-eventcatalog: a page ac to-eventcatalog wrote', () => {
  const body = [
    'Defined in `src/orders.ts` as `OrderPlaced` · declared. Published by [autocatalog](https://github.com/jagreehal/autocatalog).',
    'Placed when the customer pays.',
    '<SchemaViewer file="schema.json" />',
  ].join('\n\n');

  const narrative = async () =>
    fs.readFile(path.join(out, 'events/orders/OrderPlaced/index.mdx'), 'utf8');

  it('comes back as the narrative it was, without what the export added', async () => {
    await write(
      'domains/Orders/events/OrderPlaced/index.mdx',
      `---\nid: OrderPlaced\nversion: 1.0.0\nx-autocatalog:\n  managed: true\n---\n\n${body}\n`,
    );

    await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), quiet: true });

    expect(await narrative()).toBe('Placed when the customer pays.\n');
  });

  it('keeps all of a page someone wrote by hand', async () => {
    await write(
      'domains/Orders/events/OrderPlaced/index.mdx',
      `---\nid: OrderPlaced\nversion: 1.0.0\n---\n\n${body}\n`,
    );

    await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), quiet: true });

    expect(await narrative()).toBe(`${body}\n`);
  });
});

describe('from-eventcatalog: a command that fails to import this time', () => {
  const broken = {
    'a missing schema': doc({ id: 'Pay', version: '2.0.0', schemaPath: 'missing.json' }),
    'frontmatter that does not parse': '---\nid: Pay\nversion: [2.0.0\n---\n',
  };

  it.each(
    Object.entries(broken).flatMap(([cause, page]) =>
      [false, true].map((strict) => ({ cause, page, strict })),
    ),
  )('keeps the version it had: $cause (strict: $strict)', async ({ page, strict }) => {
    const project = { source: dir, out: path.join(out, 'events'), cwd: out, quiet: true };

    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write(
      'services/Till/index.md',
      `---\nid: Till\nversion: 1.0.0\nwritesTo:\n  - id: sales\n---\n`,
    );
    expect(await runFromEventCatalog(project)).toBe(0);

    // The service still imports, so the run goes ahead; the command does not.
    await write('commands/Pay/index.md', page);
    expect(await runFromEventCatalog({ ...project, strict })).toBe(strict ? 1 : 0);

    const manifest = JSON.parse(
      await fs.readFile(path.join(out, 'commands/eventcatalog/pay/Pay/autocatalog.json'), 'utf8'),
    );

    expect(manifest.version).toBe('1.0.0');
  });

  it('still updates the commands it could read beside a page it could not', async () => {
    const project = { source: dir, out: path.join(out, 'events'), cwd: out, quiet: true };

    const version = async (name: string) =>
      JSON.parse(
        await fs.readFile(
          path.join(out, `commands/eventcatalog/${name.toLowerCase()}/${name}/autocatalog.json`),
          'utf8',
        ),
      ).version;

    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write('commands/Refund/index.md', doc({ id: 'Refund', version: '1.0.0' }));
    expect(await runFromEventCatalog(project)).toBe(0);

    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '2.0.0' }));
    await write('commands/Refund/index.md', '---\nid: Refund\nversion: [2.0.0\n---\n');
    await runFromEventCatalog(project);

    expect(await version('Pay')).toBe('2.0.0');
    expect(await version('Refund')).toBe('1.0.0');
  });

  it('drops a command whose page is gone, though files remain in its folder', async () => {
    const project = { source: dir, out: path.join(out, 'events'), cwd: out, quiet: true };

    await write('commands/Pay/index.md', doc({ id: 'Pay', version: '1.0.0' }));
    await write('commands/Refund/index.md', doc({ id: 'Refund', version: '1.0.0' }));
    await write('commands/Refund/schema.json', '{"type":"object"}');
    expect(await runFromEventCatalog(project)).toBe(0);

    await fs.rm(path.join(dir, 'commands/Refund/index.md'));
    // A page of another kind that cannot be read is no reason to keep it.
    await write('services/Till/index.md', '---\nid: Till\nversion: [1.0.0\n---\n');
    expect(await runFromEventCatalog(project)).toBe(0);

    await expect(fs.readdir(path.join(out, 'commands/eventcatalog'))).resolves.toEqual(['pay']);
  });
});

describe('from-eventcatalog: a service page that cannot be read', () => {
  const project = () => ({ source: dir, out: path.join(out, 'events'), cwd: out, quiet: true });

  const record = async () =>
    parseResourceGraph(
      JSON.parse(
        await fs.readFile(path.join(out, '.autocatalog/imports/eventcatalog.json'), 'utf8'),
      ).graph,
    );

  it.each([false, true])(
    'keeps the services imported before, and what they use (strict: %s)',
    async (strict) => {
      await write('events/Paid/index.md', doc({ id: 'Paid', version: '1.0.0' }));
      await write(
        'services/Till/index.md',
        doc({ id: 'Till', version: '1.0.0', writesTo: '[{ id: sales }]' }),
      );
      await write('services/Shop/index.md', doc({ id: 'Shop', version: '1.0.0' }));
      expect(await runFromEventCatalog(project())).toBe(0);

      const before = await record();

      await write('services/Till/index.md', '---\nid: Till\nversion: [2.0.0\n---\n');
      await write(
        'services/Shop/index.md',
        doc({ id: 'Shop', version: '1.0.0', summary: 'Sells things.' }),
      );
      expect(await runFromEventCatalog({ ...project(), strict })).toBe(strict ? 1 : 0);

      const after = await record();

      // Till and its write to sales are as they were; Shop, which could be read, is updated.
      expect(after.relationships).toEqual(before.relationships);
      expect(after.resources.map((r) => r.ref.id).sort()).toEqual(
        before.resources.map((r) => r.ref.id).sort(),
      );
      expect(after.resources.find((r) => r.ref.id === 'Shop')?.summary).toBe('Sells things.');
    },
  );

  it('still drops a service whose page is gone', async () => {
    await write('events/Paid/index.md', doc({ id: 'Paid', version: '1.0.0' }));
    await write('services/Till/index.md', doc({ id: 'Till', version: '1.0.0' }));
    await write('services/Shop/index.md', doc({ id: 'Shop', version: '1.0.0' }));
    expect(await runFromEventCatalog(project())).toBe(0);

    // Its folder stays, with something else in it.
    await fs.rm(path.join(dir, 'services/Till/index.md'));
    await write('services/Till/notes.txt', 'Retired.');
    // An unreadable page of another kind is no reason to keep it.
    await write('commands/Pay/index.md', '---\nid: Pay\nversion: [1.0.0\n---\n');
    await runFromEventCatalog(project());

    expect((await record()).resources.map((r) => r.ref.id)).toEqual(['Shop']);
  });
});

describe('from-eventcatalog: teams and people', () => {
  const project = () => ({ source: dir, out: path.join(out, 'events'), cwd: out, quiet: true });

  async function source() {
    await write(
      'teams/ordering.mdx',
      doc({
        id: 'ordering',
        name: 'Ordering Platform',
        email: 'ordering@acme.test',
        slackDirectMessageUrl: 'https://acme.slack.com/channels/ordering',
      }),
    );
    await write(
      'users/jane.md',
      doc({ id: 'jane', name: 'Jane Doe', email: 'jane@acme.test', role: 'Lead' }),
    );
    await write(
      'events/Placed/index.md',
      doc({ id: 'Placed', version: '1.0.0', owners: '[ordering]' }),
    );
    await write(
      'commands/Pay/index.md',
      doc({ id: 'Pay', version: '1.0.0', owners: '[{ id: ordering, collection: teams }]' }),
    );
    await write(
      'services/Till/index.md',
      doc({ id: 'Till', version: '1.0.0', owners: '[jane]', writesTo: '[{ id: sales }]' }),
    );
  }

  it('names each owner as its page does, with where to reach it', async () => {
    await source();
    expect(await runFromEventCatalog(project())).toBe(0);

    const ordering = {
      team: 'ordering',
      name: 'Ordering Platform',
      contact: 'https://acme.slack.com/channels/ordering',
    };

    expect((await load()).get('Placed@1.0.0')?.frontmatter.owner).toEqual(ordering);

    const command = JSON.parse(
      await fs.readFile(path.join(out, 'commands/eventcatalog/pay/Pay/autocatalog.json'), 'utf8'),
    );

    expect(command.owner).toEqual(ordering);

    const { graph } = JSON.parse(
      await fs.readFile(path.join(out, '.autocatalog/imports/eventcatalog.json'), 'utf8'),
    );

    expect(
      graph.resources.find((r: { ref: { kind: string } }) => r.ref.kind === 'service').owner,
    ).toEqual({ team: 'jane', name: 'Jane Doe', contact: 'mailto:jane@acme.test' });
    expect(said.join('\n')).not.toContain('Not imported');
  });

  it('links no contact a browser would run, and names a team that owns nothing', async () => {
    await source();
    await write(
      'teams/ordering.mdx',
      doc({ id: 'ordering', name: 'Ordering', slackDirectMessageUrl: 'javascript:alert(1)' }),
    );
    await write('teams/idle.md', doc({ id: 'idle', name: 'Idle' }));
    await runFromEventCatalog({ ...project(), quiet: false });

    expect((await load()).get('Placed@1.0.0')?.frontmatter.owner).toEqual({
      team: 'ordering',
      name: 'Ordering',
    });
    expect(said.join('\n')).toContain('Not imported: teams (1)');
  });
});

describe('from-eventcatalog: systems', () => {
  it('puts each service in the system that lists or holds it', async () => {
    const system = 'domains/Shop/systems/checkout-system';

    await write(
      `${system}/index.mdx`,
      doc({
        id: 'checkout',
        name: 'Checkout System',
        version: '1.0.0',
        services: '[{ id: Cart }]',
      }),
    );
    await write('domains/Shop/services/Cart/index.md', doc({ id: 'Cart', version: '1.0.0' }));
    await write(`${system}/services/Pay/index.md`, doc({ id: 'Pay', version: '1.0.0' }));
    await write('domains/Shop/services/Ship/index.md', doc({ id: 'Ship', version: '1.0.0' }));
    await write('systems/stripe/index.md', doc({ id: 'stripe', version: '1.0.0' }));
    // A folder whose name only starts with the system's is another system.
    await write(`${system}-legacy/index.md`, doc({ id: 'legacy', version: '1.0.0' }));
    await write(`${system}-legacy/services/Old/index.md`, doc({ id: 'Old', version: '1.0.0' }));

    expect(
      await runFromEventCatalog({ source: dir, out: path.join(out, 'events'), cwd: out }),
    ).toBe(0);

    const { graph } = JSON.parse(
      await fs.readFile(path.join(out, '.autocatalog/imports/eventcatalog.json'), 'utf8'),
    );

    const systemOf = (id: string) =>
      graph.resources.find((r: { ref: { id: string } }) => r.ref.id === id).attributes.system;

    expect(systemOf('Cart')).toEqual({ id: 'checkout', name: 'Checkout System' });
    expect(systemOf('Pay')).toEqual({ id: 'checkout', name: 'Checkout System' });
    expect(systemOf('Ship')).toBeUndefined();
    expect(systemOf('Old')).toEqual({ id: 'legacy' });
    // A system with no services has nothing to group.
    expect(said.join('\n')).toContain('Not imported: systems (1)');
  });
});
