import { describe, expect, it } from 'vitest';
import type { LoadedEvent } from '../src/load';
import {
  AUTOCATALOG_GRAPH_SPEC,
  composeResourceGraphs,
  createEventResourceGraph,
  createResourceGraphComposer,
  relationshipKey,
  ResourceGraphConflictError,
  resourceKey,
  summarizeResourceGraph,
  type ResourceGraph,
} from '../src/resource-graph';
import { eventFrontmatter } from '../src/schema';

function loaded(
  id: string,
  domain: string,
  options: {
    producers?: string[];
    consumers?: string[];
    version?: string;
    summary?: string;
    isVersioned?: boolean;
  } = {},
): LoadedEvent {
  const frontmatter = eventFrontmatter.parse({
    id,
    version: options.version ?? '1.0.0',
    name: id,
    summary: options.summary ?? `${id} contract`,
    domain,
    producers: options.producers ?? [],
    consumers: options.consumers ?? [],
    provenance: {
      default: 'extracted',
      fields: { producers: 'declared', consumers: 'overridden' },
    },
    confidence: 0.9,
  });

  return {
    folder: {
      path: `/events/${domain}/${id}`,
      defaultDomain: domain,
      isVersioned: options.isVersioned ?? false,
      parentEventPath: options.isVersioned ? `/events/${domain}/${id}` : null,
    },
    frontmatter: { ...frontmatter, domain },
    body: '',
    schemaPath: `/events/${domain}/${id}/schema.json`,
    schema: { type: 'object' },
    examples: [],
  };
}

describe('resource graph', () => {
  it('keeps a declared consumer declared, and says how strongly a snapshot named the rest', () => {
    const event = loaded('order.placed', 'orders', { consumers: ['Billing', 'Analytics'] });

    event.frontmatter = {
      ...event.frontmatter,
      provenance: { default: 'extracted', fields: { consumers: 'observed' } },
      observed: {
        count: 3,
        firstSeen: '2026-10-01T00:00:00Z',
        lastSeen: '2026-10-02T00:00:00Z',
        consumers: ['Analytics'],
        producers: [],
        declaredConsumers: ['Billing'],
        consumerEvidence: 'reported',
        snapshot: { spec: 'autocatalog/snapshot-v1', generatedAt: '2026-10-02T00:00:00Z' },
      },
    };

    const edges = createEventResourceGraph([event]).relationships.filter(
      (edge) => edge.type === 'consumes',
    );

    expect(edges.map((edge) => [edge.to.id, edge.provenance, edge.attributes])).toEqual([
      ['Analytics', 'observed', { attribution: 'reported' }],
      ['Billing', 'extracted', undefined],
    ]);
  });

  it('compiles deterministic resources and relationships regardless of event order', () => {
    const first = loaded('payment.completed', 'payments', {
      producers: ['Payments'],
      consumers: ['Ledger'],
    });

    const second = loaded('refund.issued', 'payments', {
      producers: ['Payments'],
      consumers: ['Ledger'],
    });

    expect(createEventResourceGraph([first, second])).toEqual(
      createEventResourceGraph([second, first]),
    );

    const graph = createEventResourceGraph([first, second]);
    expect(graph.resources.filter((resource) => resource.ref.kind === 'service')).toHaveLength(2);
    expect(graph.relationships).toHaveLength(4);
    expect(
      graph.relationships.filter((relationship) => relationship.provenance === 'overridden'),
    ).toHaveLength(2);
    expect(
      graph.relationships.filter((relationship) => relationship.provenance === 'declared'),
    ).toHaveLength(2);
  });

  it('qualifies event identity by domain and version without reference collisions', () => {
    const graph = createEventResourceGraph([
      loaded('updated', 'payments'),
      loaded('updated', 'orders'),
    ]);

    const keys = graph.resources.map((resource) => resourceKey(resource.ref));
    expect(keys).toContain('event:orders/updated@1.0.0');
    expect(keys).toContain('event:payments/updated@1.0.0');
    expect(resourceKey({ kind: 'event', namespace: 'a/b', id: 'c' })).not.toBe(
      resourceKey({ kind: 'event', namespace: 'a', id: 'b/c' }),
    );
  });

  it('composes Adapter fragments deterministically and rejects conflicting facts', () => {
    const events = createEventResourceGraph([
      loaded('payment.completed', 'payments', { producers: ['Payments'] }),
    ]);

    const docs: ResourceGraph = {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        {
          ref: { kind: 'document', namespace: 'payments-service', id: 'runbook' },
          title: 'Payments runbook',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { repository: 'payments-service', updated: null },
        },
      ],
      relationships: [],
    };

    const composed = composeResourceGraphs(docs, events);
    expect(composed).toEqual(composeResourceGraphs(events, docs));
    expect(composed.resources.map((resource) => resource.ref.kind)).toEqual([
      'document',
      'event',
      'service',
    ]);

    const conflict: ResourceGraph = {
      ...docs,
      resources: [{ ...docs.resources[0]!, title: 'A different title' }],
    };

    expect(() => composeResourceGraphs(docs, conflict)).toThrow(ResourceGraphConflictError);
  });

  it('refuses a contradicting fragment whole, keeping what was composed before it', () => {
    const payments = createEventResourceGraph(
      [loaded('payment.completed', 'payments', { consumers: ['Ledger'] })],
      { repository: 'payments-service' },
    );

    // Its new event is fine; its Ledger service contradicts the one already there.
    const contradiction = createEventResourceGraph(
      [loaded('order.placed', 'orders', { consumers: ['Ledger'] })],
      { repository: 'orders-service' },
    );

    contradiction.resources = contradiction.resources.map((resource) =>
      resource.ref.kind === 'service' ? { ...resource, title: 'Not the Ledger' } : resource,
    );

    const composer = createResourceGraphComposer();
    composer.add(payments);

    expect(() => composer.add(contradiction)).toThrow(ResourceGraphConflictError);
    expect(composer.graph()).toEqual(composeResourceGraphs(payments));
  });

  it('unifies an inferred Service observed by more than one repository Adapter', () => {
    const payments = createEventResourceGraph(
      [loaded('payment.completed', 'payments', { consumers: ['Ledger'] })],
      { repository: 'payments-service' },
    );

    const orders = createEventResourceGraph(
      [loaded('order.placed', 'orders', { consumers: ['Ledger'] })],
      { repository: 'orders-service' },
    );

    const graph = composeResourceGraphs(payments, orders);

    const ledger = graph.resources.find(
      (resource) => resourceKey(resource.ref) === 'service:Ledger',
    );

    expect(ledger).toMatchObject({ attributes: { domains: ['orders', 'payments'] } });
  });

  it('keeps the same domain, id and version from two repositories as two events', () => {
    const ours = createEventResourceGraph(
      [loaded('payment.completed', 'payments', { summary: 'Card payments settled' })],
      { repository: 'payments-service' },
    );

    const theirs = createEventResourceGraph(
      [loaded('payment.completed', 'payments', { summary: 'Invoices paid' })],
      { repository: 'legacy-billing' },
    );

    const events = composeResourceGraphs(ours, theirs).resources.filter(
      (resource) => resource.ref.kind === 'event',
    );

    expect(events.map((resource) => [resource.ref.namespace, resource.summary])).toEqual([
      ['legacy-billing/payments', 'Invoices paid'],
      ['payments-service/payments', 'Card payments settled'],
    ]);
  });

  it('omits historical folders from the current graph', () => {
    const graph = createEventResourceGraph([
      loaded('payment.completed', 'payments'),
      loaded('payment.completed', 'payments', { version: '0.9.0', isVersioned: true }),
    ]);

    expect(graph.resources.filter((resource) => resource.ref.kind === 'event')).toHaveLength(1);
  });

  it('connects a repository to Events when filesystem context supplies its identity', () => {
    const event = loaded('payment.completed', 'payments');
    const graph = createEventResourceGraph([event], { repository: 'payments-service' });

    expect(graph.resources.map((resource) => resourceKey(resource.ref))).toContain(
      'repository:payments-service',
    );
    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'defines',
        from: { kind: 'repository', id: 'payments-service' },
        to: {
          kind: 'event',
          namespace: 'payments-service/payments',
          id: 'payment.completed',
          version: '1.0.0',
        },
        provenance: 'inferred',
      }),
    );
  });

  it('summarizes kinds, evidence, relationships, and review state', () => {
    const graph = createEventResourceGraph([
      loaded('payment.completed', 'payments', {
        producers: ['Payments'],
        consumers: ['Ledger'],
      }),
    ]);

    expect(summarizeResourceGraph(graph)).toEqual({
      resources: 3,
      resourcesByKind: { event: 1, service: 2 },
      relationships: 2,
      relationshipsByType: { consumes: 1, produces: 1 },
      provenance: { declared: 1, extracted: 1, inferred: 2, overridden: 1, observed: 0 },
      needsReview: 0,
    });
    expect(graph.relationships.map(relationshipKey)).toEqual(
      [...graph.relationships]
        .sort((a, b) => relationshipKey(a).localeCompare(relationshipKey(b)))
        .map(relationshipKey),
    );
  });
});
