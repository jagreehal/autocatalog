import { describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  type CatalogRelationship,
  type CatalogResource,
  type JsonObject,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import { buildChannels } from '../src/channels';

const graph = (
  resources: ResourceGraph['resources'],
  relationships: ResourceGraph['relationships'] = [],
): ResourceGraph => ({ spec: AUTOCATALOG_GRAPH_SPEC, resources, relationships });

const queue = (ref: ResourceRef<'queue'>, attributes: JsonObject = {}): CatalogResource => ({
  ref,
  title: ref.id,
  tags: [],
  provenance: { default: 'observed', fields: {} },
  needsReview: false,
  attributes,
});

const edge = (
  type: CatalogRelationship['type'],
  from: ResourceRef,
  to: ResourceRef,
): CatalogRelationship => ({ type, from, to, provenance: 'observed', needsReview: false });

describe('buildChannels', () => {
  it('lists observed queues with bindings and design-only channels', () => {
    const rows = buildChannels(
      graph(
        [queue({ kind: 'queue', id: 'payments.captured' }, { system: 'kafka' })],
        [
          edge(
            'publishes',
            { kind: 'service', id: 'PaymentService' },
            { kind: 'queue', id: 'payments.captured' },
          ),
        ],
      ),
      [
        {
          repository: 'orders',
          id: 'checkout',
          resources: [{ id: 'orders.placed', type: 'channel', name: 'orders.placed' }],
        },
      ],
      '/',
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'payments.captured',
          system: 'kafka',
          bindings: ['PaymentService'],
          source: 'observed',
        }),
        expect.objectContaining({
          id: 'orders.placed',
          source: 'design',
          designHref: '/designs/orders/checkout/',
        }),
      ]),
    );
  });
});

describe('buildChannels with namespaced queues', () => {
  it('keeps same-named destinations in different systems apart', () => {
    const rows = buildChannels(
      graph(
        [
          queue({ kind: 'queue', namespace: 'kafka', id: 'orders' }, {}),
          queue({ kind: 'queue', namespace: 'sqs', id: 'orders' }, {}),
        ],
        [
          edge(
            'publishes',
            { kind: 'service', id: 'Checkout' },
            { kind: 'queue', namespace: 'kafka', id: 'orders' },
          ),
          edge(
            'consumes',
            { kind: 'queue', namespace: 'sqs', id: 'orders' },
            { kind: 'service', id: 'Billing' },
          ),
        ],
      ),
      [],
      '/',
    );

    expect(rows.map((row) => [row.id, row.bindings])).toEqual([
      ['kafka:orders', ['Checkout']],
      ['sqs:orders', ['Billing']],
    ]);
  });
});
