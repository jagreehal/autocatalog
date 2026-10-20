import { AUTOCATALOG_GRAPH_SPEC, eventFrontmatter, type ResourceGraph } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { CatalogEvent } from '../src/catalog';
import {
  edgeWeight,
  edgesForFrame,
  liveFrame,
  normaliseEventId,
  replaySchedule,
} from '../src/ui/lib/visualiser';
import {
  catalogGraph,
  domainNeighbourhood,
  flowGraph,
  runtimeByEvent,
  serviceNeighbourhood,
} from '../src/visualiser';

const facts = {
  tags: [],
  provenance: { default: 'declared' as const, fields: {} },
  needsReview: false,
};

describe('flowGraph', () => {
  it('draws producers into the resource and the resource into its consumers, linking each node', () => {
    const map = flowGraph({
      from: [{ label: 'PaymentService', href: '/services/PaymentService/', kind: 'service' }],
      inbound: 'publishes',
      centre: { label: 'Payment captured', detail: 'v1.0.0', kind: 'event' },
      outbound: 'subscribed by',
      to: [{ label: 'LedgerService', href: '/services/LedgerService/', kind: 'service' }],
    });

    expect(map?.graph.nodes.map((node) => [node.type, node.label])).toEqual([
      ['service', 'PaymentService'],
      ['event', 'Payment captured'],
      ['service', 'LedgerService'],
    ]);
    expect(map?.graph.nodes[1]?.metadata).toEqual({ version: '1.0.0' });
    expect(map?.graph.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ['from-0', 'centre', 'publishes'],
      ['centre', 'to-0', 'subscribed by'],
    ]);
    expect(map?.hrefs).toEqual({
      'from-0': '/services/PaymentService/',
      'to-0': '/services/LedgerService/',
    });
  });

  it('draws the event snapshot evidence on its service edges, and leaves agents alone', () => {
    const map = flowGraph(
      {
        from: [
          { label: 'PaymentService', kind: 'service' },
          { label: 'LegacyBilling', kind: 'service' },
        ],
        inbound: 'publishes',
        centre: { label: 'Payment captured', kind: 'event' },
        outbound: 'subscribed by',
        to: [
          { label: 'LedgerService', kind: 'service' },
          { label: 'FraudService', kind: 'service' },
          { label: 'Triage agent', kind: 'agent' },
        ],
      },
      {
        event: 'payment.captured',
        seen: {
          declaredProducers: ['PaymentService'],
          declaredConsumers: ['LedgerService'],
          observed: {
            count: 40,
            producers: ['PaymentService', 'LegacyBilling'],
            consumers: ['FraudService'],
            sources: [],
          },
        },
        live: { url: '/events', event: 'message' },
      },
    );

    expect(
      Object.fromEntries(Object.entries(map?.evidence ?? {}).map(([id, edge]) => [id, edge.state])),
    ).toEqual({
      'from-0->centre': 'observed',
      'from-1->centre': 'undocumented',
      'centre->to-0': 'unseen',
      'centre->to-1': 'undocumented',
    });
    expect(map?.live).toEqual({ url: '/events', event: 'message' });
  });

  it('claims no producer ran when the snapshot saw the event but named no producer', () => {
    const map = flowGraph(
      {
        from: [{ label: 'PaymentService', kind: 'service' }],
        inbound: 'publishes',
        centre: { label: 'Payment captured', kind: 'event' },
        outbound: 'subscribed by',
        to: [{ label: 'LedgerService', kind: 'service' }],
      },
      {
        event: 'payment.captured',
        seen: {
          declaredProducers: ['PaymentService'],
          declaredConsumers: ['LedgerService'],
          observed: { count: 40, producers: [], consumers: ['LedgerService'], sources: [] },
        },
      },
    );

    expect(Object.keys(map?.evidence ?? {})).toEqual(['centre->to-0']);
  });

  it('draws nothing for a kind EventCatalog has no node for', () => {
    expect(
      flowGraph({
        from: [],
        inbound: 'x',
        centre: { label: 'Runbook', kind: 'doc' },
        outbound: 'y',
        to: [],
      }),
    ).toBeUndefined();
  });
});

describe('catalogGraph', () => {
  const graph: ResourceGraph = {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [
      {
        ...facts,
        ref: { kind: 'service', id: 'PaymentService' },
        title: 'PaymentService',
        attributes: { domains: ['payments'] },
      },
      {
        ...facts,
        ref: { kind: 'event', id: 'payment.captured' },
        title: 'Payment captured',
        url: '/events/p/payment.captured/',
        attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
      },
      {
        ...facts,
        ref: { kind: 'agent', id: 'refund-agent' },
        title: 'Refund agent',
        attributes: {},
      },
      { ...facts, ref: { kind: 'model', id: 'fast-model' }, title: 'Fast model', attributes: {} },
      {
        ...facts,
        ref: { kind: 'document', id: 'runbook' },
        title: 'Runbook',
        attributes: { repository: 'payments-service', updated: null },
      },
    ],
    relationships: [
      {
        type: 'produces',
        from: { kind: 'service', id: 'PaymentService' },
        to: { kind: 'event', id: 'payment.captured' },
        provenance: 'declared',
        needsReview: false,
      },
      {
        type: 'usesModel',
        from: { kind: 'agent', id: 'refund-agent' },
        to: { kind: 'model', id: 'fast-model' },
        provenance: 'declared',
        needsReview: false,
      },
      {
        type: 'describes',
        from: { kind: 'document', id: 'runbook' },
        to: { kind: 'event', id: 'payment.captured' },
        provenance: 'declared',
        needsReview: false,
      },
    ],
  };

  it('maps services, events and agents, folds an agent’s model onto it, and leaves documents to the table', () => {
    const map = catalogGraph(graph, '/docs/');

    expect(map?.graph.nodes.map((node) => node.type)).toEqual(['service', 'event', 'agent']);
    expect(map?.graph.nodes[2]?.metadata).toEqual({ model: 'Fast model' });
    expect(map?.graph.edges).toEqual([
      expect.objectContaining({ type: 'publishes', label: 'publishes' }),
    ]);
  });

  it('opens a resource’s page under the base, or its row when it has none', () => {
    const hrefs = catalogGraph(graph, '/docs/')?.hrefs ?? {};

    expect(hrefs['event:payment.captured']).toBe('/docs/events/p/payment.captured/');
    expect(hrefs['service:PaymentService']).toMatch(/^\/docs\/catalog\/#resource-/);
    expect(
      catalogGraph(graph, '/docs/', { servicePages: new Set(['PaymentService']) })?.hrefs[
        'service:PaymentService'
      ],
    ).toBe('/docs/services/PaymentService/');
  });

  it('draws no map when nothing on it is connected', () => {
    expect(catalogGraph({ ...graph, relationships: [] }, '/')).toBeUndefined();
  });
});

describe('commands, queries and datastores', () => {
  const resource = (kind: string, id: string, namespace?: string, tags: string[] = []) => ({
    ...facts,
    ref: { kind, id, ...(namespace && { namespace }) },
    title: id,
    attributes: {},
    tags,
  });

  const edge = (
    type: string,
    from: [string, string],
    to: [string, string],
    namespace?: string,
  ) => ({
    type,
    from: { kind: from[0], id: from[1] },
    to: { kind: to[0], id: to[1], ...(namespace && { namespace }) },
    provenance: 'declared' as const,
    needsReview: false,
  });

  const event = (id: string, domain: string) => ({
    ...facts,
    ref: { kind: 'event', namespace: `repo/${domain}`, id },
    title: id,
    attributes: { domain, status: 'active' as const, schema: 'schema.json', examples: 0 },
  });

  // SAFETY: every fixture carries each field a resource or relationship needs;
  // only their kinds are plain strings rather than the narrowed unions.
  const graph = {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [
      resource('service', 'web'),
      resource('service', 'billing'),
      resource('service', 'ledger'),
      resource('service', 'unrelated'),
      resource('command', 'charge', 'pay'),
      resource('command', 'balance', 'pay', ['query']),
      resource('table', 'payments'),
      event('charged', 'pay'),
      event('shipped', 'ship'),
    ],
    relationships: [
      edge('sends', ['service', 'web'], ['command', 'charge'], 'pay'),
      edge('handles', ['service', 'billing'], ['command', 'charge'], 'pay'),
      edge('sends', ['service', 'web'], ['command', 'balance'], 'pay'),
      edge('writes', ['service', 'billing'], ['table', 'payments']),
      edge('produces', ['service', 'billing'], ['event', 'charged'], 'repo/pay'),
      {
        ...edge('consumes', ['event', 'charged'], ['service', 'ledger']),
        from: { kind: 'event', namespace: 'repo/pay', id: 'charged' },
      },
      edge('produces', ['service', 'unrelated'], ['event', 'shipped'], 'repo/ship'),
    ],
  } as ResourceGraph;

  it('draws commands, queries and datastores as EventCatalog does, a handler after its command', () => {
    const map = catalogGraph(graph, '/', { eventPages: new Set(['events/repo/pay/charged/']) });
    const types = Object.fromEntries(map?.graph.nodes.map((node) => [node.label, node.type]) ?? []);

    expect(types).toMatchObject({ charge: 'command', balance: 'query', payments: 'data' });
    expect(map?.graph.edges.map((e) => [e.source, e.label, e.target])).toEqual(
      expect.arrayContaining([
        ['service:web', 'sends', 'command:pay/charge'],
        ['command:pay/charge', 'handled by', 'service:billing'],
        ['service:billing', 'writes to', 'table:payments'],
      ]),
    );
    expect(map?.hrefs['event:repo%2Fpay/charged']).toBe('/events/repo/pay/charged/');
  });

  it('links an event with no page of its own to its row in the catalog', () => {
    expect(catalogGraph(graph, '/')?.hrefs['event:repo%2Fpay/charged']).toMatch(/^\/catalog\/#/);
  });

  it('shows a service who consumes what it publishes and who sends what it handles, and nothing further', () => {
    expect([...serviceNeighbourhood(graph, 'billing')].sort()).toEqual([
      'command:pay/charge',
      'event:repo%2Fpay/charged',
      'service:billing',
      'service:ledger',
      'service:web',
      'table:payments',
    ]);
  });

  it('gathers a domain’s events and commands and the services one edge away', () => {
    expect([...domainNeighbourhood(graph, 'pay')].sort()).toEqual([
      'command:pay/balance',
      'command:pay/charge',
      'event:repo%2Fpay/charged',
      'service:billing',
      'service:ledger',
      'service:web',
    ]);
  });
});

describe('runtime evidence on the map', () => {
  const ref = (kind: string, id: string, namespace?: string) => ({
    kind,
    id,
    ...(namespace && { namespace }),
  });

  const link = (type: string, from: ReturnType<typeof ref>, to: ReturnType<typeof ref>) => ({
    type,
    from,
    to,
    provenance: 'declared' as const,
    needsReview: false,
  });

  const node = (kind: string, id: string, namespace?: string) => ({
    ...facts,
    ref: ref(kind, id, namespace),
    title: id,
    attributes: {},
  });

  const charged = ref('event', 'payment.charged', 'repo/pay');
  const shipped = ref('event', 'order.shipped', 'repo/ship');
  const refunded = ref('event', 'refunded', 'other/pay');

  // SAFETY: as above, only kinds are plain strings.
  const graph = {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [
      ...['billing', 'ledger', 'audit', 'spy', 'shipping', 'refunds'].map((id) =>
        node('service', id),
      ),
      node('event', 'payment.charged', 'repo/pay'),
      node('event', 'order.shipped', 'repo/ship'),
      node('event', 'refunded', 'other/pay'),
      // An agent sharing a service's name; the snapshot says nothing of it.
      node('agent', 'ledger'),
    ],
    relationships: [
      link('produces', ref('service', 'billing'), charged),
      link('consumes', charged, ref('service', 'ledger')),
      link('consumes', charged, ref('service', 'audit')),
      // The snapshot appended a consumer nobody declared.
      link('consumes', charged, ref('service', 'spy')),
      link('produces', ref('service', 'shipping'), shipped),
      link('produces', ref('service', 'refunds'), refunded),
      link('consumes', charged, ref('agent', 'ledger')),
    ],
  } as ResourceGraph;

  // SAFETY: the evidence reads only these frontmatter fields.
  const published = (
    repository: string,
    domain: string,
    fields: Partial<z.input<typeof eventFrontmatter>>,
  ): CatalogEvent => ({
    repository,
    event: {
      folder: { path: '/', defaultDomain: domain, isVersioned: false, parentEventPath: null },
      frontmatter: {
        ...eventFrontmatter.parse({
          version: '1.0.0',
          name: 'e',
          summary: 'e',
          consumers: [],
          ...fields,
        }),
        domain,
      },
      body: '',
      schemaPath: 'schema.json',
      schema: {},
      examples: [],
    },
  });

  const window = { firstSeen: '2026-10-01', lastSeen: '2026-10-02' };

  const events = [
    published('repo', 'pay', {
      id: 'payment.charged',
      producers: ['billing'],
      consumers: ['ledger', 'audit', 'spy'],
      observed: {
        ...window,
        count: 40,
        producers: ['billing', 'rogue'],
        consumers: ['ledger', 'spy'],
        declaredConsumers: ['ledger', 'audit'],
        sources: [
          { ...window, producer: 'billing', count: 30 },
          { ...window, producer: 'rogue', count: 10 },
        ],
        snapshot: { spec: 'autotel-architecture/v1', generatedAt: '2026-10-02' },
      },
    }),
    published('repo', 'ship', { id: 'order.shipped', producers: ['shipping'] }),
    published('other', 'pay', { id: 'refunded', producers: ['refunds'] }),
  ];

  const live = { url: '/events', event: 'track' };

  const map = catalogGraph(graph, '/', { runtime: runtimeByEvent(events, ['repo']), live });

  const evidence = map?.evidence ?? {};

  const states = Object.fromEntries(
    Object.entries(evidence).map(([id, edge]) => [id, [edge.state, edge.count]]),
  );

  it('draws what ran, what was declared and never seen, and what ran undeclared', () => {
    expect(states).toEqual({
      'service:billing->event:repo%2Fpay/payment.charged:produces': ['observed', 30],
      'event:repo%2Fpay/payment.charged->service:ledger:consumes': ['observed', 40],
      'event:repo%2Fpay/payment.charged->service:audit:consumes': ['unseen', 0],
      'event:repo%2Fpay/payment.charged->service:spy:consumes': ['undocumented', 40],
      'service:rogue->event:repo%2Fpay/payment.charged:produces': ['undocumented', 10],
      'service:shipping->event:repo%2Fship/order.shipped:produces': ['unseen', 0],
    });
  });

  it('draws a declared edge unseen when the repository’s snapshot matched none of its events', () => {
    const matchedNothing = catalogGraph(graph, '/', {
      runtime: runtimeByEvent(events, ['repo', 'other']),
    });

    expect(
      matchedNothing?.evidence?.['service:refunds->event:other%2Fpay/refunded:produces']?.state,
    ).toBe('unseen');
  });

  it('draws evidence a committed catalog carries, with no snapshot file read', () => {
    const embedded = catalogGraph(graph, '/', { runtime: runtimeByEvent(events, []) });

    expect(
      embedded?.evidence?.['service:billing->event:repo%2Fpay/payment.charged:produces']?.state,
    ).toBe('observed');
  });

  it('gives an undeclared producer a node of its own', () => {
    expect(map?.graph.nodes.find((n) => n.id === 'service:rogue')?.type).toBe('service');
  });

  it('says nothing of a repository without a snapshot, and offers live only with evidence', () => {
    expect(Object.keys(states).some((id) => id.includes('refunded'))).toBe(false);
    expect(map?.live).toEqual(live);

    const bare = catalogGraph(graph, '/', { live });

    expect(bare?.evidence).toBeUndefined();
    expect(bare?.live).toBeUndefined();
  });

  it('moves the named producer’s edge for a live frame, and every consumer’s hollow', () => {
    const moved = edgesForFrame(evidence, { name: 'PaymentCharged', producer: 'billing' });

    expect(moved).toEqual(
      expect.arrayContaining([
        { id: 'service:billing->event:repo%2Fpay/payment.charged:produces', hollow: false },
        { id: 'event:repo%2Fpay/payment.charged->service:ledger:consumes', hollow: true },
      ]),
    );
    expect(moved.some((edge) => edge.id.startsWith('service:rogue'))).toBe(false);
    expect(edgesForFrame(evidence, { name: 'order.cancelled' })).toEqual([]);
    expect(liveFrame.safeParse({ name: 7 }).success).toBe(false);
  });

  it('replays only edges that ran, busiest fastest', () => {
    const schedule = Object.fromEntries(
      replaySchedule(evidence).map((edge) => [edge.id, edge.interval]),
    );

    expect(schedule['event:repo%2Fpay/payment.charged->service:ledger:consumes']).toBe(600);
    expect(schedule['service:rogue->event:repo%2Fpay/payment.charged:produces']).toBe(2100);
    expect(schedule['event:repo%2Fpay/payment.charged->service:audit:consumes']).toBeUndefined();
  });

  it('weighs edges by volume, bounded', () => {
    expect(edgeWeight({ state: 'unseen', count: 0, event: 'x' })).toBe(1.25);
    expect(edgeWeight({ state: 'observed', count: 1, event: 'x' })).toBe(1.5);
    expect(edgeWeight({ state: 'observed', count: 1e9, event: 'x' })).toBe(6);
  });

  it('normalises event names as the core does', () => {
    expect(normaliseEventId('order.placed')).toBe(normaliseEventId('OrderPlaced'));
    expect(normaliseEventId('order_placed-v 2')).toBe('orderplacedv2');
  });
});
