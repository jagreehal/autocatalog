import { describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  resolveReferences,
  versionSatisfies,
  type CatalogResource,
  type ResourceGraph,
} from '../src';

const event = (
  domain: string,
  id: string,
  version: string,
  repository: string,
): CatalogResource => ({
  ref: { kind: 'event', namespace: `${repository}/${domain}`, id, version },
  title: id,
  tags: [],
  provenance: { default: 'declared', fields: {} },
  needsReview: false,
  attributes: { domain, status: 'active', schema: './schema.json', examples: 0 },
});

const graph = (...resources: CatalogResource[]): ResourceGraph => ({
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources,
  relationships: resources.map((resource) => ({
    type: 'defines',
    from: { kind: 'repository', id: resource.ref.namespace!.split('/')[0]! },
    to: resource.ref,
    provenance: 'inferred',
    needsReview: false,
  })),
});

describe('versionSatisfies', () => {
  it.each([
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['1.2.9', '~1.2.0', true],
    ['1.3.0', '~1.2.0', false],
    ['1.5.0', '>=1.0.0 <2.0.0', true],
    ['3.1.0', '1.x || 3.x', true],
    ['1.0.0', 'latest', true],
    ['2024-01', '2024-01', true],
    // A prerelease is not its release, and a release is not its prerelease.
    ['1.0.0-beta.1', '1.0.0', false],
    ['1.0.0', '1.0.0-beta.1', false],
    ['1.0.0-beta.1', '^1.0.0', false],
    ['1.0.0-beta.2', '>=1.0.0-beta.1', true],
    ['1.0.0-beta.1', '>=1.0.0-beta.2', false],
  ])('%s against %s is %s', (version, wanted, expected) => {
    expect(versionSatisfies(version, wanted)).toBe(expected);
  });
});

describe('resolveReferences', () => {
  const composed = graph(
    event('orders', 'order-completed', '1.0.0', 'orders'),
    event('orders', 'order-completed', '2.0.0-beta.1', 'orders'),
  );

  it('picks the newest stable release for latest, not a prerelease ahead of it', () => {
    const { graph: edges } = resolveReferences(composed, [
      {
        repository: 'fulfillment',
        receives: [{ service: 'Warehouse', id: 'order-completed' }],
        sends: [],
      },
    ]);

    expect(edges.relationships).toEqual([
      expect.objectContaining({
        type: 'consumes',
        from: expect.objectContaining({ version: '1.0.0' }),
      }),
    ]);
  });

  it('says which versions exist when none matches', () => {
    const { unresolved } = resolveReferences(composed, [
      {
        repository: 'fulfillment',
        receives: [{ service: 'Warehouse', id: 'order-completed', version: '^3' }],
        sends: [],
      },
    ]);

    expect(unresolved).toEqual([
      'fulfillment: Warehouse receives order-completed@^3, but only 1.0.0, 2.0.0-beta.1 is published',
    ]);
  });

  it('names the ambiguity when two repositories publish one id', () => {
    const { unresolved } = resolveReferences(
      graph(
        event('orders', 'order-completed', '1.0.0', 'orders'),
        event('legacy', 'order-completed', '1.0.0', 'legacy'),
      ),
      [
        {
          repository: 'fulfillment',
          receives: [{ service: 'Warehouse', id: 'order-completed' }],
          sends: [],
        },
      ],
    );

    expect(unresolved[0]).toMatch(
      /ambiguous: event legacy\/order-completed in legacy, event orders\/order-completed in orders/,
    );
  });

  it('names a service reading an earlier release than the newest', () => {
    const { behind } = resolveReferences(
      graph(event('payments', 'payment.completed', '2.0.0', 'payments')),
      [
        {
          repository: 'reporter',
          receives: [{ service: 'Reporter', id: 'payment.completed', version: '^1' }],
          sends: [],
        },
      ],
      graph(event('payments', 'payment.completed', '1.0.0', 'payments')),
    );

    expect(behind).toEqual([
      {
        repository: 'reporter',
        service: 'Reporter',
        resource: expect.objectContaining({ id: 'payment.completed', version: '1.0.0' }),
        current: '2.0.0',
      },
    ]);
  });

  it('counts a service on the newest release as current, whatever prerelease is ahead', () => {
    const { behind } = resolveReferences(composed, [
      {
        repository: 'fulfillment',
        receives: [{ service: 'Warehouse', id: 'order-completed', version: '^1' }],
        sends: [],
      },
    ]);

    expect(behind).toEqual([]);
  });

  it('compares against the newest release in history when the current one is a prerelease', () => {
    const { behind } = resolveReferences(
      graph(event('payments', 'payment.completed', '3.0.0-beta.1', 'payments')),
      [
        {
          repository: 'reporter',
          receives: [{ service: 'Reporter', id: 'payment.completed', version: '1.0.0' }],
          sends: [],
        },
      ],
      graph(
        event('payments', 'payment.completed', '1.0.0', 'payments'),
        event('payments', 'payment.completed', '2.0.0', 'payments'),
      ),
    );

    expect(behind).toEqual([
      expect.objectContaining({
        resource: expect.objectContaining({ version: '1.0.0' }),
        current: '2.0.0',
      }),
    ]);
  });

  it('does not count a service that sends an earlier release', () => {
    const { behind } = resolveReferences(
      graph(
        event('orders', 'order-completed', '1.0.0', 'orders'),
        event('orders', 'order-completed', '2.0.0', 'orders'),
      ),
      [
        {
          repository: 'fulfillment',
          receives: [],
          sends: [{ service: 'Warehouse', id: 'order-completed', version: '^1' }],
        },
      ],
    );

    expect(behind).toEqual([]);
  });

  it('resolves a range to an earlier version, and adds only that version to the graph', () => {
    const current = graph(event('payments', 'payment.completed', '2.0.0-beta.1', 'payments'));

    const earlier = graph(
      event('payments', 'payment.completed', '1.0.0', 'payments'),
      event('payments', 'payment.completed', '1.1.0', 'payments'),
    );

    const { graph: edges, unresolved } = resolveReferences(
      current,
      [
        {
          repository: 'orders',
          receives: [
            { service: 'OrderService', id: 'payment.completed', version: '^1' },
            { service: 'Audit', id: 'payment.completed' },
          ],
          sends: [],
        },
      ],
      earlier,
    );

    expect(unresolved).toEqual([]);
    expect(
      edges.relationships.flatMap((edge) =>
        edge.type === 'consumes' ? [`${edge.to.id} ${edge.from.version}`] : [],
      ),
    ).toEqual(['OrderService 1.1.0', 'Audit 1.1.0']);
    // The version picked joins the graph with its publisher, and only that one.
    expect(edges.resources.flatMap((r) => (r.ref.kind === 'event' ? [r.ref.version] : []))).toEqual(
      ['1.1.0'],
    );
    expect(edges.relationships).toContainEqual(
      expect.objectContaining({
        type: 'defines',
        from: { kind: 'repository', id: 'payments' },
        to: expect.objectContaining({ version: '1.1.0' }),
      }),
    );
  });

  it('says a duplicate owner cannot be settled by domain/id', () => {
    const { unresolved } = resolveReferences(
      graph(
        event('payments', 'payment.completed', '1.0.0', 'payments'),
        event('payments', 'payment.completed', '1.0.0', 'legacy-payments'),
      ),
      [
        {
          repository: 'ledger',
          receives: [{ service: 'Ledger', id: 'payments/payment.completed' }],
          sends: [],
        },
      ],
    );

    expect(unresolved).toEqual([
      'ledger: Ledger receives payments/payment.completed, which legacy-payments and payments both define. Each id has one owner: remove one copy',
    ]);
  });
});
