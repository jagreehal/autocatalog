import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CatalogResource } from 'autocatalog-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  dataProductDiagram,
  entityDiagram,
  glossaryGraph,
  lookupTerm,
  readDomainModel,
} from '../src/model';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-model-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const evidence = { provenance: { default: 'declared' as const, fields: {} }, needsReview: false };

const captured: CatalogResource = {
  ref: { kind: 'event', namespace: 'payments/payments', id: 'payment.captured' },
  title: 'Payment captured',
  tags: [],
  ...evidence,
  attributes: {
    domain: 'payments',
    status: 'active',
    schema: 'schema.json',
    examples: 0,
    payloadSchema: {
      type: 'object',
      properties: { payment: { type: 'object', properties: { paymentId: { type: 'string' } } } },
    },
  },
};

const payments: CatalogResource = {
  ref: { kind: 'service', id: 'PaymentService' },
  title: 'PaymentService',
  tags: [],
  ...evidence,
  attributes: { domains: ['payments'] },
};

const catalog = { resources: [captured, payments] };

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const read = (options = {}) =>
  readDomainModel([{ repository: 'payments', dir: path.join(root, 'payments') }], catalog, options);

it('reads a domain glossary and finds a term by id or name', async () => {
  await write(
    'payments/glossary/payments.md',
    `---
dictionary:
  - { id: capture, name: Capture, summary: Taking money that was authorised. }
  - { id: chargeback, name: Chargeback }
---
`,
  );

  const model = read();

  expect(model.failures).toEqual([]);
  expect(model.glossaries[0]).toMatchObject({ domain: 'payments', file: 'glossary/payments.md' });
  expect(lookupTerm(model.glossaries, 'capt')).toEqual([
    expect.objectContaining({ id: 'capture', domain: 'payments', repository: 'payments' }),
  ]);
});

it('joins a term to what implements it, and turns it into a graph an agent can read', async () => {
  await write(
    'payments/glossary/payments.md',
    `---
dictionary:
  - id: capture
    name: Capture
    aliases: [settlement]
    about: [service/PaymentService, event/payments/payment.captured, service/Nowhere]
---
`,
  );

  const model = read();

  expect(model.glossaries[0]?.terms[0]?.refs).toEqual([payments.ref, captured.ref]);
  expect(model.warnings).toContainEqual(
    expect.stringMatching(
      /^payments\/glossary\/payments\.md: term 'capture' about 'service\/Nowhere' does not resolve/,
    ),
  );

  const graph = glossaryGraph(model.glossaries, (domain, term) => `/glossary/#${domain}-${term}`);

  expect(graph.resources).toEqual([
    expect.objectContaining({
      ref: { kind: 'term', namespace: 'payments/payments', id: 'capture' },
      title: 'Capture',
      url: '/glossary/#payments-capture',
      attributes: { domain: 'payments', aliases: ['settlement'] },
    }),
  ]);
  expect(graph.relationships.map((edge) => [edge.type, edge.to.id])).toEqual([
    ['describes', 'PaymentService'],
    ['describes', 'payment.captured'],
  ]);
});

it('refuses a term defined twice in one domain, and warns of a domain nothing names', async () => {
  await write(
    'payments/glossary/payments.md',
    '---\ndictionary:\n  - { id: capture, name: Capture }\n  - { id: capture, name: Capture again }\n---\n',
  );
  await write(
    'payments/glossary/billing.md',
    '---\ndictionary:\n  - { id: invoice, name: Invoice }\n---\n',
  );

  const model = read();

  expect(model.failures).toEqual([
    "payments/glossary/payments.md: term 'capture' is defined twice",
  ]);
  expect(model.warnings).toEqual([
    "payments/glossary/billing.md: no event or service names domain 'billing'",
  ]);
});

it('reads an entity from a JSON Schema and finds the events that carry its identifier', async () => {
  await write(
    'payments/contracts/payment.schema.json',
    JSON.stringify({
      type: 'object',
      required: ['paymentId'],
      properties: {
        paymentId: { type: 'string', description: 'Unique.' },
        status: { enum: ['authorised', 'captured'], type: 'string' },
      },
    }),
  );
  await write(
    'payments/entities/payment.md',
    `---
name: Payment
aggregateRoot: true
identifier: paymentId
schema: contracts/payment.schema.json
services: [PaymentService]
domains: [payments]
---
A payment from authorisation to settlement.
`,
  );

  const [payment] = read().entities;

  expect(payment).toMatchObject({
    name: 'Payment',
    aggregateRoot: true,
    body: 'A payment from authorisation to settlement.',
    services: [{ name: 'PaymentService', ref: payments.ref }],
    carriedBy: [captured.ref],
  });
  expect(payment!.properties).toEqual([
    { name: 'paymentId', type: 'string', required: true, description: 'Unique.' },
    { name: 'status', type: 'string', enum: ['authorised', 'captured'] },
  ]);
});

it('refuses an entity whose identifier, service or schema is not there', async () => {
  await write(
    'payments/entities/refund.md',
    '---\nname: Refund\nidentifier: refundId\nproperties:\n  - { name: id, type: string }\n---\n',
  );
  await write('payments/entities/ledger.md', '---\nname: Ledger\nservices: [LedgerService]\n---\n');
  await write('payments/entities/card.md', '---\nname: Card\nschema: ../outside.json\n---\n');
  await write('outside.json', '{}');
  await write('payments/entities/token.md', '---\nname: Token\nschema: contracts/link.json\n---\n');
  await fs.mkdir(path.join(root, 'payments/contracts'), { recursive: true });
  await fs.symlink(
    path.join(root, 'outside.json'),
    path.join(root, 'payments/contracts/link.json'),
  );

  expect(read().failures).toEqual([
    "payments/entities/card.md: '../outside.json' is outside the repository",
    "payments/entities/ledger.md: service 'LedgerService' is not in the catalog",
    "payments/entities/refund.md: identifier 'refundId' is not one of its properties",
    "payments/entities/token.md: 'contracts/link.json' is outside the repository",
  ]);
  expect(read({ deferMissing: true }).entities.map((entity) => entity.id)).toEqual(['ledger']);
});

it('draws the entities one references as an ER diagram', async () => {
  await write(
    'payments/entities/payment.md',
    '---\nname: Payment\nproperties:\n  - { name: refunds, type: array, references: refund }\n  - { name: card, type: string, references: card }\n---\n',
  );
  await write('payments/entities/refund.md', '---\nname: Refund\n---\n');

  const model = read();

  expect(model.warnings).toEqual([
    "payments/entities/payment.md: references 'card', which no entities/ file defines",
  ]);
  expect(entityDiagram(model.entities)).toBe(
    'erDiagram\n  payment["Payment"]\n  refund["Refund"]\n  payment ||--o{ refund : "refunds"',
  );
});

it('resolves a data product’s inputs and outputs, and maps them', async () => {
  await write('payments/contracts/revenue.schema.json', '{}');
  await write(
    'payments/data-products/revenue.md',
    `---
name: Daily revenue
inputs: [event/payments/payment.captured]
outputs:
  - { ref: data-product/forecast, contract: contracts/revenue.schema.json }
---
`,
  );
  await write(
    'payments/data-products/forecast.md',
    '---\nname: Forecast\ninputs: [data-product/revenue]\n---\n',
  );
  await write(
    'payments/data-products/broken.md',
    '---\nname: Broken\ninputs: [event/payments/payment.capturd]\n---\n',
  );

  await write(
    'payments/data-products/downstream.md',
    '---\nname: Downstream\ninputs: [data-product/broken]\n---\n',
  );

  const model = read();

  expect(model.failures).toEqual([
    "payments/data-products/broken.md: 'event/payments/payment.capturd' does not resolve — did you mean 'event/payments/payment.captured'?",
    "payments/data-products/downstream.md: data product 'broken' fails its own checks",
  ]);
  expect(model.dataProducts.map((product) => product.id)).toEqual(['forecast', 'revenue']);

  const revenue = model.dataProducts.find((product) => product.id === 'revenue')!;

  expect(revenue.inputs).toEqual([
    { reference: 'event/payments/payment.captured', ref: captured.ref, contract: undefined },
  ]);

  const { nodes, edges } = dataProductDiagram(revenue, catalog);

  expect(nodes.map((node) => [node.type, node.label])).toEqual([
    ['data-product', 'Daily revenue'],
    ['event', 'Payment captured'],
    ['data-product', 'forecast'],
  ]);
  expect(edges.map((edge) => edge.label)).toEqual(['feeds', 'publishes']);
});

it('defines an entity id in one repository', async () => {
  await write('payments/entities/refund.md', '---\nname: Refund\n---\n');
  await write('ledger/entities/refund.md', '---\nname: Ledger refund\n---\n');

  const model = readDomainModel(
    [
      { repository: 'ledger', dir: path.join(root, 'ledger') },
      { repository: 'payments', dir: path.join(root, 'payments') },
    ],
    catalog,
  );

  expect(model.entities.map((entity) => [entity.repository, entity.id])).toEqual([
    ['ledger', 'refund'],
  ]);
  expect(model.failures).toEqual([
    "payments/entities/refund.md: entity 'refund' is already defined in ledger/entities/refund.md",
  ]);
});

it('defines a data product id in one repository', async () => {
  const product = (name: string) =>
    `---\nname: ${name}\ninputs: [event/payments/payment.captured]\n---\n`;

  await write('payments/data-products/revenue.md', product('Revenue'));
  await write('ledger/data-products/revenue.md', product('Ledger revenue'));

  const model = readDomainModel(
    [
      { repository: 'ledger', dir: path.join(root, 'ledger') },
      { repository: 'payments', dir: path.join(root, 'payments') },
    ],
    catalog,
  );

  expect(model.dataProducts.map((product) => [product.repository, product.id])).toEqual([
    ['ledger', 'revenue'],
  ]);
  expect(model.failures).toEqual([
    "payments/data-products/revenue.md: data product 'revenue' is already defined in ledger/data-products/revenue.md",
  ]);
});

it('reads teams and users once each, and warns of a member with no profile', async () => {
  await write(
    'payments/teams/payments-team.md',
    '---\nname: Payments\nemail: payments@acme.test\nmembers: [ada, grace]\n---\n',
  );
  await write('payments/users/ada.md', '---\nname: Ada\nrole: Engineer\n---\n');
  await write('handbook/users/ada.md', '---\nname: Ada L\n---\n');

  const model = readDomainModel(
    [
      { repository: 'handbook', dir: path.join(root, 'handbook') },
      { repository: 'payments', dir: path.join(root, 'payments') },
    ],
    catalog,
  );

  expect(model.people.map((person) => [person.kind, person.id, person.name])).toEqual([
    ['team', 'payments-team', 'Payments'],
    ['user', 'ada', 'Ada L'],
  ]);
  expect(model.failures).toEqual([
    "payments/users/ada.md: user 'ada' is already described in handbook/users/ada.md",
  ]);
  expect(model.warnings).toEqual([
    "payments/teams/payments-team.md: member 'grace' has no users/grace.md",
  ]);
});
