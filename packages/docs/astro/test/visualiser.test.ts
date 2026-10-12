import { AUTOCATALOG_GRAPH_SPEC, type ResourceGraph } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { catalogGraph, flowGraph } from '../src/visualiser';

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
    expect(hrefs['service:PaymentService']).toMatch(/^#resource-/);
  });

  it('draws no map when nothing on it is connected', () => {
    expect(catalogGraph({ ...graph, relationships: [] }, '/')).toBeUndefined();
  });
});
