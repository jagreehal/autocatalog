import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { designSchema } from 'autocatalog-docs-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { catalogMap, describeMap, draftMap } from '../src/map.js';
import { createServer } from '../src/server.js';
import { loadCatalog } from '../src/tools.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-map-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const event = (id: string, producers: string[], consumers: string[], extra = {}) =>
  write(
    `events/payments/${id}/autocatalog.json`,
    JSON.stringify({
      spec: 'autocatalog/v2',
      id,
      version: '1.0.0',
      name: id,
      summary: `${id}.`,
      domain: 'payments',
      owner: { team: 'payments-team' },
      producers,
      consumers,
      schema: 'schema.json',
      ...extra,
    }),
  ).then(() => write(`events/payments/${id}/schema.json`, '{"type":"object"}'));

it('draws the part of the catalog around a service, with what a snapshot saw on each edge', async () => {
  await event('payment.captured', ['PaymentService'], ['ShippingService'], {
    observed: {
      count: 12,
      firstSeen: '2026-10-01T00:00:00Z',
      lastSeen: '2026-10-02T00:00:00Z',
      snapshot: { spec: 'autotel/architecture-snapshot-v1', generatedAt: '2026-10-02T00:00:00Z' },
      producers: ['PaymentService'],
      consumers: [],
      declaredConsumers: ['ShippingService'],
    },
  });
  await event('refund.issued', ['RefundService'], ['LedgerService']);

  const catalog = await loadCatalog(path.join(root, 'events'));

  const map = catalogMap(catalog, 'service/PaymentService');

  expect(map.title).toBe('PaymentService');
  expect(map.nodes.map((node) => node.label).sort()).toEqual([
    'PaymentService',
    'ShippingService',
    'payment.captured',
  ]);
  expect(describeMap(map).split('\n')).toEqual([
    'PaymentService: 3 nodes, 2 edges.',
    '- payment.captured subscribed by ShippingService [unseen]',
    '- PaymentService publishes payment.captured [observed, 12 seen]',
  ]);

  expect(() => catalogMap(catalog, 'service/PaymentServce')).toThrow(/PaymentService/);
});

it('draws a flow grouped as its frontmatter says', async () => {
  await event('payment.captured', ['PaymentService'], []);
  await write(
    'flows/checkout.md',
    `---
title: Checkout
lanes: { by: team, style: lanes }
steps:
  - id: customer
    actor: { name: Customer }
    next_step: pay
  - id: pay
    service: PaymentService
    next_step: captured
  - id: captured
    event: payments/payment.captured
---
`,
  );

  const catalog = await loadCatalog(path.join(root, 'events'));

  const map = catalogMap(catalog, 'flow/checkout');

  expect(map.lanes).toEqual({ by: 'team', style: 'lanes' });
  expect(map.steps?.captured?.lanes?.team).toEqual({
    id: 'payments-team',
    name: 'payments-team',
  });
  expect(() => catalogMap(catalog, 'flow/refund')).toThrow("No flow 'refund' under flows/");
});

it('offers show_map as an MCP App: the view by its resource, the map as structured content', async () => {
  await event('payment.captured', ['PaymentService'], ['ShippingService']);

  const server = createServer(await loadCatalog(path.join(root, 'events')));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const { tools } = await client.listTools();

  expect(tools.find((tool) => tool.name === 'show_map')?._meta).toMatchObject({
    ui: { resourceUri: 'ui://autocatalog/map.html' },
  });

  const result = await client.callTool({ name: 'show_map', arguments: {} });

  expect(result.structuredContent).toMatchObject({ title: 'Catalog' });
  expect(result.content).toEqual([
    { type: 'text', text: expect.stringContaining('PaymentService publishes payment.captured') },
  ]);
});

it('draws a design under designs/, or one drafted in the conversation, with what is new', async () => {
  await event('payment.captured', ['PaymentService'], []);
  await write(
    'designs/refunds.md',
    `---
title: Refunds
resources:
  - { id: PaymentService, type: service }
  - { ref: event/payments/payment.captured }
  - { id: RefundService, type: service }
relations:
  - { from: RefundService, to: payment.captured, kind: receives }
---
`,
  );

  const catalog = await loadCatalog(path.join(root, 'events'));

  const committed = catalogMap(catalog, 'design/refunds');

  expect(committed.proposed).toEqual(['RefundService']);
  expect(describeMap(committed)).toContain('1 new service and 1 new relation.');

  const draft = draftMap(
    catalog,
    designSchema.parse({
      title: 'Ledger',
      resources: [{ ref: 'service/PaymentService' }, { id: 'LedgerService', type: 'service' }],
      relations: [
        { from: 'PaymentService', to: 'LedgerService', kind: 'connects', label: 'posts to' },
      ],
    }),
  );

  expect(draft.proposed).toEqual(['LedgerService']);
  // The tool's input schema is the design schema, so a draft that does not hold together is refused by name.
  const server = createServer(catalog);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const refused = await client.callTool({
    name: 'show_map',
    arguments: { design: { title: 'Untyped', resources: [{ id: 'RefundService' }] } },
  });

  expect(refused.isError).toBe(true);
  expect(JSON.stringify(refused.content)).toContain('resources');
});

it('draws a domain, which events name rather than declare as a resource', async () => {
  await event('payment.captured', ['PaymentService'], ['LedgerService']);

  const catalog = await loadCatalog(path.join(root, 'events'));

  const map = catalogMap(catalog, 'domain/payments');

  expect(map.title).toBe('payments');
  expect(map.nodes.map((node) => node.label).sort()).toEqual([
    'LedgerService',
    'PaymentService',
    'payment.captured',
  ]);
  expect(() => catalogMap(catalog, 'domain/paymnts')).toThrow(
    "No domain 'paymnts'. Domains here: payments",
  );
});

it('reads flows and designs from the repository root, wherever its events directory sits', async () => {
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  await event('payment.captured', ['PaymentService'], []);
  await fs.rename(path.join(root, 'events'), path.join(root, 'generated/events'));
  await write(
    'designs/ledger.md',
    `---
title: Ledger
resources:
  - { ref: service/PaymentService }
  - { id: LedgerService, type: service }
relations:
  - { from: PaymentService, to: LedgerService, kind: connects }
---
`,
  );

  const catalog = await loadCatalog(path.join(root, 'generated/events'), root);

  expect(catalogMap(catalog, 'design/ledger').title).toBe('Ledger');
});

it('resolves an agent the agent catalog beside the events declares, in a draft or a flow', async () => {
  await event('payment.captured', ['PaymentService'], []);
  await write(
    'agents/refund-agent/autocatalog.json',
    JSON.stringify({
      name: 'Refund agent',
      owner: 'Payments',
      description: 'Prepares a refund.',
      model: 'fast-model',
      tools: [],
      policies: [],
      risk: 'high',
    }),
  );
  await write(
    'flows/refund.md',
    `---
title: Refund
steps:
  - id: agent
    agent: refund-agent
    next_step: captured
  - id: captured
    event: payments/payment.captured
---
`,
  );

  // An agent naming a model the catalog does not have keeps the agents off the
  // map, and every other tool working.
  const broken = await loadCatalog(path.join(root, 'events'));

  expect(broken.mapGraphFailure).toMatch(/unknown Model "fast-model"/);
  expect(catalogMap(broken, 'service/PaymentService').title).toBe('PaymentService');

  await write(
    'models/fast-model.yaml',
    'id: fast-model\nname: Fast model\nowner: Platform AI\nprovider: openai\nmodel_id: gpt-5-mini\n',
  );

  const catalog = await loadCatalog(path.join(root, 'events'));

  expect(catalog.mapGraphFailure).toBeUndefined();

  const draft = draftMap(
    catalog,
    designSchema.parse({
      title: 'Refunds',
      resources: [{ ref: 'agent/refund-agent' }, { id: 'RefundService', type: 'service' }],
      relations: [{ from: 'refund-agent', to: 'RefundService', kind: 'connects' }],
    }),
  );

  expect(draft.proposed).toEqual(['RefundService']);
  expect(catalogMap(catalog, 'flow/refund').nodes.map((node) => node.label)).toEqual([
    'Refund agent',
    'payment.captured',
  ]);
});

it('keeps an agent that consumes a service’s event on the map focused on that service', async () => {
  await event('payment.captured', ['PaymentService'], []);
  await write(
    'agents/refund-agent/autocatalog.json',
    JSON.stringify({
      name: 'Refund agent',
      owner: 'Payments',
      description: 'Prepares a refund.',
      model: 'fast-model',
      tools: [],
      policies: [],
      risk: 'high',
      consumes: [{ event: 'payments/payment.captured' }],
    }),
  );
  await write(
    'models/fast-model.yaml',
    'id: fast-model\nname: Fast model\nowner: Platform AI\nprovider: openai\nmodel_id: gpt-5-mini\n',
  );

  const catalog = await loadCatalog(path.join(root, 'events'));

  expect(catalog.mapGraphFailure).toBeUndefined();
  expect(catalogMap(catalog).nodes.map((node) => node.label)).toContain('Refund agent');
  expect(
    catalogMap(catalog, 'service/PaymentService')
      .nodes.map((node) => node.label)
      .sort(),
  ).toEqual(['PaymentService', 'Refund agent', 'payment.captured']);
});

it('defines a word from the glossary and entities, and maps a data product', async () => {
  await event('payment.captured', ['PaymentService'], [], {});
  await write(
    'events/payments/payment.captured/schema.json',
    '{"type":"object","properties":{"paymentId":{"type":"string"}}}',
  );
  await write(
    'glossary/payments.md',
    '---\ndictionary:\n  - { id: capture, name: Capture, summary: Taking authorised money. }\n---\n',
  );
  await write(
    'entities/payment.md',
    '---\nname: Payment\nidentifier: paymentId\nproperties:\n  - { name: paymentId, type: string }\n---\n',
  );
  await write(
    'data-products/revenue.md',
    '---\nname: Revenue\ninputs: [event/payments/payment.captured]\n---\n',
  );

  const catalog = await loadCatalog(path.join(root, 'events'));

  const server = createServer(catalog);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const capture = await client.callTool({ name: 'define', arguments: { query: 'capture' } });

  expect(JSON.stringify(capture.content)).toContain('Taking authorised money.');

  const payment = await client.callTool({ name: 'define', arguments: { query: 'payment' } });

  expect(JSON.stringify(payment.content)).toContain('payment.captured');

  const unknown = await client.callTool({ name: 'define', arguments: { query: 'ledger' } });

  expect(unknown.isError).toBe(true);
  expect(JSON.stringify(unknown.content)).toContain('Defined: Capture, Payment');

  expect(catalogMap(catalog, 'data-product/revenue').nodes.map((node) => node.label)).toEqual([
    'Revenue',
    'payment.captured',
  ]);
});
