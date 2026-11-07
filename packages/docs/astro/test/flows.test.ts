import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { flowPageProps, flowRecords, flowVisualiser } from '../src/flows';
import { eventPages, servicePages } from '../src/page-models';

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

it('opens a flow grouped as its frontmatter says, with a step’s own lane over the catalog’s', async () => {
  await event('payments-service', 'payments', 'payment.captured', 'PaymentService');
  await write(
    'handbook/flows/checkout.md',
    flow
      .replace('title: Checkout\n', 'title: Checkout\nlanes: { by: team, style: lanes }\n')
      .replace(
        '    actor: { name: Customer }\n',
        '    actor: { name: Customer }\n    lane: { team: Storefront }\n',
      )
      .replace(
        '    event: payments/payment.captured\n',
        '    event: payments/payment.captured\n    lane: { team: Finance }\n',
      ),
  );

  await write('handbook/docs/index.md', '---\ntitle: Handbook\nowner: Ops\n---\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  const map = flowVisualiser(catalog.flows[0]!, catalog, '/', {});

  expect(map.lanes).toEqual({ by: 'team', style: 'lanes' });
  expect(map.steps?.customer?.lanes).toEqual({ team: { id: 'Storefront', name: 'Storefront' } });
  expect(map.steps?.captured?.lanes).toEqual({
    domain: { id: 'payments', name: 'payments' },
    team: { id: 'Finance', name: 'Finance' },
  });
});

it('shows how the saga that runs a flow went, from the snapshot of the repository that runs it', async () => {
  await event('payments-service', 'payments', 'payment.captured', 'PaymentService');
  await write(
    'payments-service/.autotel/snapshot.json',
    JSON.stringify({
      spec: 'autotel-architecture/v0.1.0',
      generatedAt: '2026-10-28T00:00:00Z',
      service: 'payments',
      events: {},
      workflows: {
        Checkout: {
          name: 'Checkout',
          runs: 3,
          firstSeen: '',
          lastSeen: '',
          completed: 2,
          compensated: 1,
          steps: [
            { name: 'pay', count: 3, compensated: 1 },
            { name: 'FraudCheck', count: 3, failed: 1 },
          ],
          sampleTraceIds: ['abc123'],
        },
      },
    }),
  );
  await write('handbook/flows/checkout.md', flow);

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const props = await flowPageProps(catalog.flows[0]!, catalog, '/', {});

  expect(props.runtime).toEqual({
    workflow: 'Checkout',
    repository: 'payments-service',
    summary: 'Ran 3 times: 2 completed, 1 compensated.',
    unnamed: ['FraudCheck'],
    sampleTraceIds: ['abc123'],
  });
  expect(props.steps.find((step) => step.id === 'pay')?.runtime).toBe(
    'Ran 3 times: 1 compensated.',
  );
  expect(props.steps.find((step) => step.id === 'customer')?.runtime).toBeUndefined();
});

it('shows a transition, its evidence and an open finding on the flow page', async () => {
  await write(
    'orders/entities/order.md',
    '---\nname: Order\nlifecycles:\n  status:\n    states: [new, working, done]\n    initial: new\n---\n',
  );
  await write(
    'orders/flows/fulfil.md',
    `---
title: Fulfilling an order
entity: order
field: status
steps:
  - id: started
    title: Work started
    transition: { from: new, to: working }
    rules: [Stock is reserved first]
    stuck: { signs: no task is running }
    next_step: finished
  - id: finished
    title: Work finished
    transition: { from: working, to: done, via: worker }
---
`,
  );
  await write(
    'orders/docs/findings/stuck.md',
    `---
title: Stuck in working
owner: Ops
nature: question
status: draft
date: 2026-11-06
flow: fulfil
step: started
---
`,
  );
  await write(
    'orders/docs/findings/known.md',
    `---
title: Retries are normal
owner: Ops
nature: behaviour
status: confirmed
date: 2026-11-06
flow: fulfil
step: finished
---
`,
  );
  await write(
    'orders/flows/evidence.json',
    JSON.stringify({
      spec: 'autocatalog-flow-evidence/v0.1.0',
      checkedAt: '2026-11-01',
      commit: 'abcdef1234',
      transitions: [
        {
          flow: 'fulfil',
          step: 'finished',
          entity: 'order',
          field: 'status',
          from: ['working'],
          to: 'done',
          via: 'worker',
          declared: 'yes',
          schema: 'not checked',
          code: 'no',
          observed: 'yes',
          rules: 'none',
          count: 9,
          otherVia: { operator: 2 },
        },
      ],
      undeclared: [
        { entity: 'order', field: 'status', from: 'done', to: 'new', via: 'x', count: 1 },
      ],
    }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const pages = { servicePages: servicePages(catalog), eventPages: eventPages(catalog) };

  const page = await flowPageProps(
    catalog.flows[0]!,
    catalog,
    '/',
    pages,
    Date.parse('2026-12-20'),
  );

  const [started, finished] = page.steps;

  expect(started).toMatchObject({
    transition: { field: 'order.status', change: 'new → working' },
    rules: ['Stock is reserved first'],
    stuck: { signs: 'no task is running' },
    notes: [{ title: 'Stuck in working', nature: 'question', status: 'draft', hotspot: true }],
  });
  expect(finished!.notes).toMatchObject([{ title: 'Retries are normal', hotspot: false }]);
  expect(finished!.evidence).toContainEqual({
    label: 'Observed',
    value: 'yes, 9; also 2 via operator',
  });

  // The first step has no record, so it reads unchecked rather than blank.
  expect(started!.evidence).toContainEqual({ label: 'Observed', value: 'not checked' });

  const moved = await flowPageProps(
    {
      ...catalog.flows[0]!,
      steps: catalog.flows[0]!.steps.map((step) =>
        step.id === 'finished' ? { ...step, transition: { ...step.transition!, to: 'new' } } : step,
      ),
    },
    catalog,
    '/',
    pages,
  );

  expect(moved.steps[1]!.evidence).toContainEqual({ label: 'Observed', value: 'not checked' });
  expect(moved.steps[1]!.evidence).toContainEqual({ label: 'Code linked', value: 'not checked' });
  expect(page.evidence).toMatchObject({ stale: true, commit: 'abcdef1234' });
  expect(page.evidence!.undeclared[0]).toContain('done → new');

  const labels = page.visualiser.graph.nodes.map((node) => node.label);

  expect(labels).toEqual(['Work started (1 open)', 'Work finished']);
});
