import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CatalogRelationship, CatalogResource } from 'autocatalog-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { flowDiagram } from '../src/diagram';
import { flowStepRuns, flowWorkflow, readFlows } from '../src/flows';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-flows-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const evidence = { provenance: { default: 'declared' as const, fields: {} }, needsReview: false };

const placed: CatalogResource = {
  ref: { kind: 'event', namespace: 'orders/orders', id: 'order.placed' },
  title: 'Order placed',
  tags: [],
  ...evidence,
  attributes: { domain: 'orders', status: 'active', schema: 'schema.json', examples: 0 },
};

const service = (id: string): CatalogResource => ({
  ref: { kind: 'service', id },
  title: id,
  tags: [],
  ...evidence,
  attributes: { domains: [] },
});

const orders = service('OrderService');

const shipping = service('ShippingService');

const edge = (
  type: 'produces' | 'consumes',
  from: CatalogResource,
  to: CatalogResource,
): CatalogRelationship => ({
  type,
  from: from.ref,
  to: to.ref,
  provenance: 'declared',
  needsReview: false,
});

const catalog = {
  resources: [placed, orders, shipping],
  relationships: [edge('produces', orders, placed)],
};

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const repositories = () => [{ repository: 'orders', dir: path.join(root, 'orders') }];

const flow = `---
title: Order to dispatch
summary: From checkout to a parcel leaving the warehouse.
steps:
  - id: customer
    actor: { name: Customer }
    next_step: place
  - id: place
    service: OrderService
    next_step: placed
  - id: placed
    event: orders/order.placed
    next_steps:
      - { id: ship, label: Paid }
      - { id: 2, label: Payment declined }
  - id: ship
    service: ShippingService
  - id: 2
    title: Tell the customer
---

Shipping starts only once payment is taken.
`;

it('reads a flow, resolving each step against the catalog', async () => {
  await write('orders/flows/order-to-dispatch.md', flow);

  const result = readFlows(repositories(), catalog);

  expect(result.failures).toEqual([]);
  expect(result.flows).toEqual([
    {
      repository: 'orders',
      id: 'order-to-dispatch',
      file: 'flows/order-to-dispatch.md',
      title: 'Order to dispatch',
      summary: 'From checkout to a parcel leaving the warehouse.',
      body: 'Shipping starts only once payment is taken.',
      steps: [
        {
          id: 'customer',
          kind: 'actor',
          title: 'Customer',
          summary: undefined,
          next: [{ id: 'place' }],
        },
        {
          id: 'place',
          kind: 'service',
          ref: orders.ref,
          title: 'OrderService',
          summary: undefined,
          next: [{ id: 'placed' }],
        },
        {
          id: 'placed',
          kind: 'event',
          ref: placed.ref,
          title: 'Order placed',
          summary: undefined,
          next: [
            { id: 'ship', label: 'Paid' },
            { id: '2', label: 'Payment declined' },
          ],
        },
        {
          id: 'ship',
          kind: 'service',
          ref: shipping.ref,
          title: 'ShippingService',
          summary: undefined,
          next: [],
        },
        {
          id: '2',
          kind: 'custom',
          title: 'Tell the customer',
          summary: undefined,
          url: undefined,
          next: [],
        },
      ],
    },
  ]);
});

it('says which hops no producer or consumer declaration backs, and still publishes the flow', async () => {
  await write('orders/flows/order-to-dispatch.md', flow);

  const result = readFlows(repositories(), catalog);

  // OrderService produces order.placed is declared; ShippingService consuming it is not.
  expect(result.warnings).toEqual([
    'orders/flows/order-to-dispatch.md: ShippingService consumes Order placed here, and no consumer declaration says so',
  ]);
  expect(result.flows).toHaveLength(1);
});

it('leaves out a flow that does not hold together, naming the file and the step', async () => {
  await write('orders/flows/typo.md', flow.replace('orders/order.placed', 'orders/order.plcaed'));
  await write('orders/flows/dangling.md', flow.replace('next_step: placed', 'next_step: nowhere'));
  await write('orders/flows/twice.md', flow.replace('  - id: ship', '  - id: place'));
  await write(
    'orders/flows/both.md',
    flow.replace(
      'service: ShippingService',
      'service: ShippingService\n    actor: { name: Courier }',
    ),
  );
  await write('orders/flows/untitled.md', flow.replace('title: Order to dispatch\n', ''));

  const result = readFlows(repositories(), catalog);

  expect(result.flows).toEqual([]);
  expect(result.failures.sort()).toEqual([
    "orders/flows/both.md: step 'ship' names service and actor; a step is one thing",
    "orders/flows/dangling.md: step 'place' leads to 'nowhere', which is not a step",
    "orders/flows/twice.md: step 'place' appears twice",
    "orders/flows/typo.md: step 'placed': 'event/orders/order.plcaed' does not resolve — did you mean 'event/orders/order.placed'?",
    expect.stringMatching(/^orders\/flows\/untitled\.md: .*title/),
  ]);
});

it('reads how a flow groups its map, and refuses a grouping or lane it cannot draw', async () => {
  await write(
    'orders/flows/team.md',
    flow
      .replace('summary: From', 'lanes: team\nsummary: From')
      .replace(
        '    service: ShippingService\n',
        '    service: ShippingService\n    lane: { system: Warehouse }\n',
      ),
  );
  await write(
    'orders/flows/lanes.md',
    flow.replace('summary: From', 'lanes: { by: system, style: lanes }\nsummary: From'),
  );
  await write(
    'orders/flows/owner.md',
    flow.replace('summary: From', 'lanes: owner\nsummary: From'),
  );
  await write(
    'orders/flows/empty.md',
    flow.replace('    service: ShippingService\n', '    service: ShippingService\n    lane: {}\n'),
  );

  const result = readFlows(repositories(), catalog);

  expect(result.flows.map(({ id, lanes }) => [id, lanes])).toEqual([
    ['lanes', { by: 'system', style: 'lanes' }],
    ['team', { by: 'team', style: 'boxes' }],
  ]);
  expect(result.flows[1]!.steps.find((step) => step.id === 'ship')!.lane).toEqual({
    system: 'Warehouse',
  });
  expect(result.failures.sort()).toEqual([
    expect.stringMatching(/^orders\/flows\/empty\.md: .*name a domain, system or team/),
    expect.stringMatching(/^orders\/flows\/owner\.md: .*lanes/),
  ]);
});

it('refuses a step link that is not a web address', async () => {
  await write(
    'orders/flows/link.md',
    flow.replace('title: Tell the customer', 'custom: { url: "javascript:alert(1)" }'),
  );

  const result = readFlows(repositories(), catalog);

  expect(result.flows).toEqual([]);
  expect(result.failures).toEqual([expect.stringMatching(/^orders\/flows\/link\.md: .*url/)]);
});

it('leaves a step naming nothing here unresolved when asked to defer it', async () => {
  await write(
    'orders/flows/order-to-dispatch.md',
    flow.replace('ShippingService', 'CarrierGateway'),
  );

  const result = readFlows(repositories(), catalog, { deferMissing: true });

  expect(result.failures).toEqual([]);
  const ship = result.flows[0]!.steps.find((step) => step.id === 'ship');

  expect(ship).toMatchObject({ kind: 'service', title: 'CarrierGateway' });
  expect(ship).not.toHaveProperty('ref');
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'names an unreadable flows folder and reads the other repositories',
  async () => {
    await write('orders/flows/order-to-dispatch.md', flow);
    await write('locked/flows/x.md', flow);
    await fs.chmod(path.join(root, 'locked/flows'), 0o000);

    try {
      const result = readFlows(
        [...repositories(), { repository: 'locked', dir: path.join(root, 'locked') }],
        catalog,
      );

      expect(result.flows.map(({ repository }) => repository)).toEqual(['orders']);
      expect(result.failures).toEqual([expect.stringMatching(/^locked\/flows: not read — /)]);
    } finally {
      await fs.chmod(path.join(root, 'locked/flows'), 0o755);
    }
  },
);

it('says when no step starts the flow, since its walkthrough could not begin', async () => {
  await write(
    'orders/flows/loop.md',
    flow.replace(
      '    title: Tell the customer',
      '    title: Tell the customer\n    next_step: customer',
    ),
  );

  const result = readFlows(repositories(), catalog);

  expect(result.warnings).toContain(
    'orders/flows/loop.md: every step has one leading to it, so its walkthrough has nowhere to start',
  );
});

it('reads the step that undoes another, and draws it as its own edge', async () => {
  await write(
    'orders/flows/charge.md',
    `---
title: Charge
steps:
  - id: reserve
    title: Reserve stock
    next_step: charge
    compensated_by: { id: release, label: payment declined }
  - id: charge
    title: Charge the card
  - id: release
    title: Release stock
---
`,
  );
  await write(
    'orders/flows/broken.md',
    '---\ntitle: Broken\nsteps:\n  - id: a\n    compensated_by: a\n---\n',
  );

  const result = readFlows(repositories(), catalog);
  const charge = result.flows.find((each) => each.id === 'charge')!;

  expect(result.failures).toEqual(["orders/flows/broken.md: step 'a' cannot compensate itself"]);
  expect(charge.steps[0]?.compensatedBy).toEqual({ id: 'release', label: 'payment declined' });
  expect(result.warnings).toEqual([]);
  expect(flowDiagram(charge, { spec: 'autocatalog/graph-v1', ...catalog }).edges).toEqual([
    { id: 'reserve->charge', source: 'reserve', target: 'charge', type: 'flow-step' },
    {
      id: 'reserve->release:compensation',
      source: 'reserve',
      target: 'release',
      type: 'flow-step',
      label: 'payment declined',
    },
  ]);
});

it('finds the saga that runs a flow, and the runs of each step', async () => {
  await write(
    'orders/flows/fulfil-order.md',
    `---
title: Fulfil order
steps:
  - id: reserve
    title: Reserve stock
    next_step: ship
  - id: ship
    title: Ship order
---
`,
  );

  const [fulfil] = readFlows(repositories(), catalog).flows;

  const workflow = {
    name: 'FulfilOrder',
    runs: 2,
    firstSeen: '',
    lastSeen: '',
    compensated: 1,
    steps: [
      { name: 'ReserveStock', count: 2, compensated: 1 },
      { name: 'ShipOrder', count: 2, failed: 1 },
      { name: 'NotifyCustomer', count: 1 },
    ],
  };

  const runs = [
    { repository: 'orders', workflow },
    { repository: 'other', workflow },
  ];

  // Its own repository's runs win over another's of the same name.
  expect(flowWorkflow(fulfil!, runs).found?.repository).toBe('orders');
  expect(flowWorkflow(fulfil!, runs.slice(1)).found?.repository).toBe('other');
  expect(flowWorkflow({ ...fulfil!, repository: 'third' }, runs).ambiguous).toEqual([
    'orders',
    'other',
  ]);
  expect(flowWorkflow({ ...fulfil!, workflow: 'Elsewhere' }, runs).found).toBeUndefined();

  const { steps, unnamed } = flowStepRuns(fulfil!, workflow);

  expect([...steps.keys()]).toEqual(['reserve', 'ship']);
  expect(steps.get('ship')?.failed).toBe(1);
  expect(unnamed).toEqual(['NotifyCustomer']);
});
