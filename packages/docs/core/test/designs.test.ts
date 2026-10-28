import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CatalogRelationship, CatalogResource } from 'autocatalog-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { designChanges, designDiagram, readDesigns } from '../src/designs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-designs-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const evidence = { provenance: { default: 'declared' as const, fields: {} }, needsReview: false };

const captured: CatalogResource = {
  ref: { kind: 'event', namespace: 'payments/payments', id: 'payment.captured' },
  title: 'Payment captured',
  summary: 'A card payment went through.',
  tags: [],
  ...evidence,
  attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
};

const payments: CatalogResource = {
  ref: { kind: 'service', id: 'PaymentService' },
  title: 'PaymentService',
  tags: [],
  ...evidence,
  attributes: { domains: ['payments'] },
};

const produces: CatalogRelationship = {
  type: 'produces',
  from: payments.ref,
  to: captured.ref,
  provenance: 'declared',
  needsReview: false,
};

const catalog = { resources: [captured, payments], relationships: [produces] };

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const repositories = () => [{ repository: 'payments', dir: path.join(root, 'payments') }];

const design = `---
title: Refunds
status: proposed
resources:
  - { id: payments, type: domain, name: Payments }
  - { id: refunds, type: system, name: Refunds, parent: payments }
  - { id: PaymentService, type: service, parent: payments }
  - { ref: event/payments/payment.captured }
  - { id: RefundService, type: service, parent: refunds }
  - { id: refund.issued, type: event, name: Refund issued }
relations:
  - { from: PaymentService, to: payment.captured, kind: sends }
  - { from: RefundService, to: payment.captured, kind: receives }
  - { from: RefundService, to: refund.issued, kind: sends }
notes:
  - { text: Who approves a refund over £500?, resource: RefundService }
---

Refunds get their own service.
`;

it('reads a design, marking what the catalog already has and what is new', async () => {
  await write('payments/designs/refunds.md', design);

  const { designs, failures } = readDesigns(repositories(), catalog);

  expect(failures).toEqual([]);

  const [refunds] = designs;

  expect(refunds).toMatchObject({
    id: 'refunds',
    status: 'proposed',
    body: 'Refunds get their own service.',
  });
  expect(refunds!.resources.map(({ id, state }) => [id, state])).toEqual([
    ['payments', 'catalog'],
    ['refunds', 'new'],
    ['PaymentService', 'catalog'],
    ['payment.captured', 'catalog'],
    ['RefundService', 'new'],
    ['refund.issued', 'new'],
  ]);
  expect(refunds!.resources[3]).toMatchObject({ name: 'Payment captured', type: 'event' });
  expect(refunds!.relations.map(({ to, kind, state }) => [kind, to, state])).toEqual([
    ['sends', 'payment.captured', 'catalog'],
    ['receives', 'payment.captured', 'new'],
    ['sends', 'refund.issued', 'new'],
  ]);
  expect(designChanges(refunds!)).toBe(
    '1 new system, 1 new service, 1 new event and 2 new relations',
  );
});

it('draws a design at three levels: everything, then services, then domains and systems', async () => {
  await write('payments/designs/refunds.md', design);

  const diagram = designDiagram(readDesigns(repositories(), catalog).designs[0]!);

  expect(diagram.nodes.map((node) => node.id)).toEqual([
    'PaymentService',
    'payment.captured',
    'RefundService',
    'refund.issued',
  ]);
  expect(diagram.proposed).toEqual(['refunds', 'RefundService', 'refund.issued']);
  // The event between the two services becomes one edge named for it.
  expect(diagram.levels[2].edges).toEqual([
    {
      id: 'PaymentService->RefundService',
      source: 'PaymentService',
      target: 'RefundService',
      type: 'calls',
      label: 'Payment captured',
    },
  ]);
  expect(diagram.levels[1]?.edges.map(({ source, target }) => [source, target])).toEqual([
    ['payments', 'refunds'],
  ]);
});

it('leaves out a design that does not hold together, naming the file and why', async () => {
  await write(
    'payments/designs/ref.md',
    design.replace('event/payments/payment.captured', 'event/payments/payment.capturd'),
  );
  await write(
    'payments/designs/dangling.md',
    design.replace('to: refund.issued', 'to: refund.isued'),
  );
  await write('payments/designs/parent.md', design.replace('parent: refunds', 'parent: refundz'));
  await write(
    'payments/designs/bare.md',
    design.replace(
      '{ id: refund.issued, type: event, name: Refund issued }',
      '{ name: Refund issued }',
    ),
  );

  const { designs, failures } = readDesigns(repositories(), catalog);

  expect(designs).toEqual([]);
  expect(failures.sort()).toEqual([
    expect.stringMatching(/^payments\/designs\/bare\.md: .*`ref`/),
    "payments/designs/dangling.md: relation RefundService sends refund.isued: 'refund.isued' is not a resource",
    "payments/designs/parent.md: resource 'RefundService' sits in 'refundz', which is not a resource",
    expect.stringMatching(
      /^payments\/designs\/ref\.md: .*did you mean 'event\/payments\/payment\.captured'/,
    ),
  ]);
});

it('shows a domain at level 1 even when everything in it stays inside it', async () => {
  await write(
    'payments/designs/inside.md',
    `---
title: Inside payments
resources:
  - { id: payments, type: domain, name: Payments }
  - { id: PaymentService, type: service, parent: payments }
  - { id: LedgerService, type: service, parent: payments }
relations:
  - { from: PaymentService, to: LedgerService, kind: connects, label: posts to }
---
`,
  );

  const diagram = designDiagram(readDesigns(repositories(), catalog).designs[0]!);

  expect(diagram.levels[1]?.nodes.map((node) => node.id)).toEqual(['payments']);
  expect(diagram.levels[1]?.edges).toEqual([]);
});

it('draws a domain or system a relation names, so no edge is left without its end', async () => {
  await write(
    'payments/designs/owned.md',
    `---
title: Owned
resources:
  - { id: payments, type: domain, name: Payments }
  - { id: refunds, type: system, name: Refunds }
  - { id: LedgerService, type: service }
relations:
  - { from: payments, to: LedgerService, kind: connects, label: owns }
---
`,
  );

  const diagram = designDiagram(readDesigns(repositories(), catalog).designs[0]!);

  const ends = (level: {
    nodes: Array<{ id: string }>;
    edges: Array<{ source: string; target: string }>;
  }) => {
    const ids = new Set(level.nodes.map((node) => node.id));

    return level.edges
      .flatMap(({ source, target }) => [source, target])
      .filter((id) => !ids.has(id));
  };

  // The related domain is drawn, as a card; the unrelated system is not.
  expect(diagram.nodes.map(({ id, type, metadata }) => [id, type, metadata.group])).toEqual([
    ['payments', 'step', 'domain'],
    ['LedgerService', 'service', undefined],
  ]);
  expect(ends(diagram)).toEqual([]);
  expect(ends(diagram.levels[2])).toEqual([]);
  expect(ends(diagram.levels[1]!)).toEqual([]);
});
