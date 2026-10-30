import type { CatalogRelationship, CatalogResource } from 'autocatalog-core';
import { expect, it } from 'vitest';
import { designEvidence, designFromModel, designModel, designReview } from '../src/design-model';
import { designSchema, resolveDesign } from '../src/designs';

const evidence = { provenance: { default: 'declared' as const, fields: {} }, needsReview: false };

const captured: CatalogResource = {
  ref: { kind: 'event', namespace: 'payments/payments', id: 'payment.captured' },
  title: 'Payment captured',
  summary: 'A card payment went through.',
  owner: { team: 'Payments' },
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

const ledger: CatalogResource = {
  ref: { kind: 'service', id: 'LedgerService' },
  title: 'LedgerService',
  tags: [],
  ...evidence,
  attributes: { domains: ['payments'] },
};

const relationship = (
  type: CatalogRelationship['type'],
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
  resources: [captured, payments, ledger],
  relationships: [
    relationship('produces', payments, captured),
    relationship('consumes', captured, ledger),
  ],
};

const authored = designSchema.parse({
  title: 'Refunds',
  status: 'proposed',
  resources: [
    { id: 'payments', type: 'domain', name: 'Payments' },
    { ref: 'event/payments/payment.captured' },
    { id: 'RefundService', type: 'service', parent: 'payments' },
  ],
  relations: [{ from: 'RefundService', to: 'payment.captured', kind: 'receives' }],
  notes: [{ text: 'Who approves a refund over £500?', resource: 'RefundService' }],
});

const where = { repository: 'payments', id: 'refunds', file: 'designs/refunds.md' };

const design = resolveDesign(authored, catalog, where);

it('opens a design on the canvas with resolved names and each ref kept', () => {
  const model = designModel(authored, design);

  expect(model.resources[1]).toEqual({
    id: 'payment.captured',
    type: 'event',
    name: 'Payment captured',
    summary: 'A card payment went through.',
    ref: 'event/payments/payment.captured',
  });
});

it('writes back what the file said when nothing changed on the canvas', () => {
  const back = designSchema.parse(designFromModel(designModel(authored, design), authored, design));

  expect(back).toEqual(authored);
});

it('writes what the canvas changed: a new resource, a renamed ref, a hotspot and positions', () => {
  const model = designModel(authored, design);

  model.resources[1]!.name = 'Card payment captured';
  // As the canvas makes them: an id of its own, named after itself in the file.
  model.resources.push({ id: 'event-1a2b3c4d', type: 'event', name: 'Refund issued' });
  model.relations.push({ from: 'RefundService', to: 'event-1a2b3c4d', kind: 'sends' });
  model.hotspots = [
    { title: 'No idempotency key', severity: 'critical', resource: 'RefundService' },
  ];
  model.layout = {
    messages: { RefundService: { x: 10, y: 20 }, 'event-1a2b3c4d': { x: 0, y: 0 } },
  };

  const back = designSchema.parse(designFromModel(model, authored, design));

  expect(back.resources[1]).toEqual({
    ref: 'event/payments/payment.captured',
    name: 'Card payment captured',
  });
  expect(back.resources[3]).toEqual({ id: 'refund-issued', type: 'event', name: 'Refund issued' });
  expect(back.relations[1]).toEqual({ from: 'RefundService', to: 'refund-issued', kind: 'sends' });
  expect(back.hotspots).toEqual([
    { title: 'No idempotency key', severity: 'critical', resource: 'RefundService' },
  ]);
  expect(back.layout).toEqual({
    messages: { RefundService: { x: 10, y: 20 }, 'refund-issued': { x: 0, y: 0 } },
  });
  expect(() => resolveDesign(back, catalog, where)).not.toThrow();
});

it('names who a design asks: the owner of each catalog resource a new relation touches', () => {
  const review = designReview(design, catalog);

  expect(review.changes).toBe('1 new service and 1 new relation');
  expect(review.added).toEqual([{ id: 'RefundService', name: 'RefundService', type: 'service' }]);
  expect(review.impact).toEqual([
    {
      name: 'Payment captured',
      kind: 'event',
      owner: 'Payments',
      changes: ['RefundService receives it'],
      dependents: ['LedgerService', 'PaymentService'],
    },
  ]);
});

it('keeps a domain summary the canvas has no place for', () => {
  const withSummary = designSchema.parse({
    ...authored,
    resources: [
      { id: 'payments', type: 'domain', name: 'Payments', summary: 'Taking money.' },
      ...authored.resources.slice(1),
    ],
  });

  const resolved = resolveDesign(withSummary, catalog, where);
  const model = designModel(withSummary, resolved);

  // As Studio's canvas gives a domain box back: no summary.
  delete model.resources[0]!.summary;

  const back = designSchema.parse(designFromModel(model, withSummary, resolved));

  expect(back.resources[0]).toMatchObject({ summary: 'Taking money.' });
});

it('draws what a snapshot saw on the design, and names who ran that the design leaves out', () => {
  const drawn = resolveDesign(
    designSchema.parse({
      title: 'Captures',
      resources: [{ ref: 'service/PaymentService' }, { ref: 'event/payments/payment.captured' }],
      relations: [{ from: 'PaymentService', to: 'payment.captured', kind: 'sends' }],
    }),
    catalog,
    where,
  );

  const runtime = new Map([
    [
      'payments/payments/payment.captured',
      {
        declaredProducers: ['PaymentService'],
        declaredConsumers: ['LedgerService'],
        observed: {
          count: 40,
          producers: ['PaymentService'],
          consumers: ['LedgerService', 'FraudService'],
          sources: [],
        },
      },
    ],
  ]);

  expect(designEvidence(drawn, runtime)).toEqual({
    relations: [
      {
        from: 'PaymentService',
        to: 'payment.captured',
        kind: 'sends',
        evidence: expect.objectContaining({ state: 'observed', count: 40 }),
      },
    ],
    undrawn: [
      { event: 'Payment captured', service: 'LedgerService', role: 'consumes', count: 40 },
      { event: 'Payment captured', service: 'FraudService', role: 'consumes', count: 40 },
    ],
  });
  expect(designEvidence(drawn, new Map())).toBeUndefined();
});
