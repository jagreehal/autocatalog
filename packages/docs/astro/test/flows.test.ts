import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { flowRecords, flowVisualiser } from '../src/flows';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-site-flows-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const event = async (repository: string, domain: string, id: string, producer: string) => {
  const folder = `${repository}/events/${domain}/${id}`;

  await write(
    `${folder}/autocatalog.json`,
    JSON.stringify({
      spec: 'autocatalog/v2',
      id,
      version: '1.0.0',
      name: id,
      summary: `${id}.`,
      domain,
      owner: { team: `${domain}-team` },
      producers: [producer],
      schema: 'schema.json',
    }),
  );
  await write(`${folder}/schema.json`, '{"type":"object"}');
};

const flow = `---
title: Checkout
steps:
  - id: customer
    actor: { name: Customer }
    next_step: pay
  - id: pay
    title: Take payment
    service: PaymentService
    next_step: captured
  - id: captured
    event: payments/payment.captured
---

Narrative.
`;

it('publishes a flow that names another repository’s resources, with each step’s lanes', async () => {
  await event('payments-service', 'payments', 'payment.captured', 'PaymentService');
  await write('handbook/flows/checkout.md', flow);
  await write('handbook/docs/index.md', '---\ntitle: Handbook\nowner: Ops\n---\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.flows.map(({ repository, id }) => [repository, id])).toEqual([
    ['handbook', 'checkout'],
  ]);

  const map = flowVisualiser(catalog.flows[0]!, catalog, '/', {});

  expect(map.graph.edges.map(({ source, target, type }) => [source, target, type])).toEqual([
    ['customer', 'pay', 'flow-step'],
    ['pay', 'captured', 'flow-step'],
  ]);
  expect(map.steps).toEqual({
    customer: { step: { id: 'customer', title: 'Customer' }, lanes: { external: true } },
    // The walkthrough reads the step's own title, not the node's id.
    pay: {
      step: {
        id: 'pay',
        title: 'Take payment',
        summary: 'Service inferred from Event producer and consumer declarations.',
      },
      lanes: { domain: { id: 'payments', name: 'payments' } },
    },
    captured: {
      step: { id: 'captured', title: 'payment.captured', summary: 'payment.captured.' },
      lanes: {
        domain: { id: 'payments', name: 'payments' },
        team: { id: 'payments-team', name: 'payments-team' },
      },
    },
  });

  expect(
    flowRecords(
      catalog.flows,
      { kind: 'event', namespace: 'payments-service/payments', id: 'payment.captured' },
      '/',
    ),
  ).toEqual([
    {
      id: 'flows',
      heading: 'Flows',
      links: [{ href: '/flows/handbook/checkout/', title: 'Checkout', label: 'handbook' }],
    },
  ]);
});

it('leaves out a flow naming a repository that was quarantined, and says so', async () => {
  await write('payments-service/events/payments/broken/autocatalog.json', '{');
  await write('handbook/flows/checkout.md', flow);
  await write('handbook/docs/index.md', '---\ntitle: Handbook\nowner: Ops\n---\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.flows).toEqual([]);
  expect(catalog.warnings).toContainEqual(
    expect.stringMatching(
      /^handbook\/flows\/checkout\.md: step 'pay': 'service\/PaymentService' does not resolve.*, so it is left out$/,
    ),
  );
});
