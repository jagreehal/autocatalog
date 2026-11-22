import { expect, it } from 'vitest';
import { AUTOCATALOG_GRAPH_SPEC, type CatalogResource, type LoadedEvent } from 'autocatalog-core';
import type { Entity } from 'autocatalog-docs-core';
import { recentChanges } from '../src/recent';

// SAFETY: recentChanges reads an event's name, domain, id and folder, nothing else.
const event = (id: string, name: string, folder: string) => ({
  repository: 'payments',
  event: { frontmatter: { name, domain: 'billing', id }, folder: { path: folder } } as LoadedEvent,
});

// SAFETY: recentChanges reads an entity's repository, id, name and file.
const entity = (id: string, name: string) =>
  ({ repository: 'payments', id, name, file: `entities/${id}.md` }) as Entity;

const catalog = {
  events: [
    event('payment.captured', 'Payment captured', '/repos/payments/events/payment.captured'),
    // Discovered from code: compiled outside the repository, so git cannot date the folder.
    event('payment.refunded', 'Payment refunded', '/tmp/compiled/payment.refunded'),
  ],
  graph: {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [
      // SAFETY: recentChanges reads a resource's ref and source file only.
      {
        ref: { kind: 'event', namespace: 'payments/billing', id: 'payment.refunded' },
        source: { type: 'code', file: 'contracts/events/payment.refunded.json' },
      } as CatalogResource,
    ],
    relationships: [],
  },
  apis: [],
  specifications: [],
  model: {
    glossaries: [],
    entities: [entity('invoice', 'Invoice'), entity('refund', 'Refund')],
    dataProducts: [],
    people: [],
  },
  models: [],
  repositoryRoots: { payments: '/repos/payments' },
};

const dates = new Map([
  ['/repos/payments/events/payment.captured', '2026-11-10T09:00:00Z'],
  ['/repos/payments/entities/invoice.md', '2026-11-12T09:00:00Z'],
  ['/repos/payments/contracts/events/payment.refunded.json', '2026-11-09T09:00:00Z'],
]);

const changed = (file: string) => dates.get(file) ?? null;

it('lists documents and resources newest first, leaving out what git cannot date', () => {
  const recent = recentChanges(
    catalog,
    [
      {
        id: 'payments/runbook',
        repo: 'payments',
        title: 'Runbook',
        owner: '',
        updated: '2026-11-11T09:00:00Z',
        tags: [],
      },
    ],
    '/docs/',
    changed,
  );

  expect(recent.map(({ kind, title }) => `${kind}: ${title}`)).toEqual([
    'Entity: Invoice',
    'Document: Runbook',
    'Event: Payment captured',
    'Event: Payment refunded',
  ]);
  expect(recent[2]?.href).toBe('/docs/events/payments/billing/payment.captured/');
});

it('keeps only the newest few', () => {
  expect(recentChanges(catalog, [], '/docs/', changed, 1)).toHaveLength(1);
});
