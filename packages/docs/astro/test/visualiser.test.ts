import { AUTOCATALOG_GRAPH_SPEC, type ResourceGraph } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import {
  catalogGraph,
  domainNeighbourhood,
  flowGraph,
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
