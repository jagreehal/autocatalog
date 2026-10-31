import { describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  taskContext,
  type CatalogResource,
  type JsonObject,
  type ResourceGraph,
} from '../src/index';

const resource = (
  ref: CatalogResource['ref'],
  title: string,
  extra: Partial<Omit<CatalogResource, 'attributes'>> & { attributes?: JsonObject } = {},
): CatalogResource =>
  // SAFETY: the fields every resource has; `attributes` holds what a document or term carries.
  ({
    ref,
    title,
    tags: [],
    provenance: { default: 'declared', fields: {} },
    needsReview: false,
    attributes: {},
    ...extra,
  }) as CatalogResource;

const refunded: CatalogResource['ref'] = {
  kind: 'event',
  namespace: 'payments/payments',
  id: 'payment.refunded',
  version: '1.0.0',
};

const paymentService: CatalogResource['ref'] = { kind: 'service', id: 'PaymentService' };

const ledger: CatalogResource['ref'] = { kind: 'service', id: 'LedgerService' };

const adr: CatalogResource['ref'] = {
  kind: 'document',
  namespace: 'payments',
  id: 'adr/0017-refund-accounting',
};

const runbook: CatalogResource['ref'] = {
  kind: 'document',
  namespace: 'payments',
  id: 'runbooks/refund-stuck',
};

const graph: ResourceGraph = {
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources: [
    resource(refunded, 'Payment refunded', {
      summary: 'A full refund was issued for a captured payment.',
      owner: { team: 'Payments' },
      source: { repo: 'payments', file: 'src/refund.ts' },
    }),
    resource(paymentService, 'PaymentService', { owner: { team: 'Payments' } }),
    resource(ledger, 'LedgerService'),
    resource(adr, 'Refunds post a reversing ledger entry', {
      attributes: {
        repository: 'payments',
        updated: '2026-09-01',
        kind: 'adr',
        status: 'accepted',
      },
    }),
    resource(runbook, 'Refund stuck in pending', {
      attributes: { repository: 'payments', updated: '2026-08-12', kind: 'runbook' },
    }),
    resource({ kind: 'event', namespace: 'shop/orders', id: 'order.placed' }, 'Order placed'),
  ],
  relationships: [
    {
      type: 'produces',
      from: paymentService,
      to: { kind: 'event', namespace: 'payments/payments', id: 'payment.refunded' },
      provenance: 'declared',
      needsReview: false,
    },
    {
      type: 'consumes',
      from: refunded,
      to: ledger,
      provenance: 'declared',
      needsReview: false,
      evidence: { count: 4, sampleTraceIds: [], coverage: 'unknown' },
    },
    {
      type: 'consumes',
      from: refunded,
      to: { kind: 'service', id: 'Analytics' },
      provenance: 'observed',
      needsReview: true,
    },
    { type: 'describes', from: adr, to: refunded, provenance: 'declared', needsReview: false },
    { type: 'describes', from: runbook, to: refunded, provenance: 'declared', needsReview: false },
  ],
};

describe('taskContext', () => {
  const context = taskContext(graph, 'Add partial refunds');

  it('matches the task by the words resources are named with', () => {
    expect(context.terms).toEqual(['partial', 'refunds']);
    expect(context.matches[0]).toEqual({
      key: 'event:payments%2Fpayments/payment.refunded',
      matched: ['refunds'],
    });
    expect(context.contracts[0]).toMatchObject({
      owner: 'Payments',
      source: 'payments:src/refund.ts',
    });
    expect(context.matches.map((match) => match.key)).not.toContain(
      'event:shop%2Forders/order.placed',
    );
  });

  it('brings in the producer, consumers, decision and runbook one hop out', () => {
    expect(context.services.map((service) => service.title)).toEqual(
      expect.arrayContaining(['PaymentService', 'LedgerService']),
    );
    expect(context.decisions).toEqual([
      expect.objectContaining({
        title: 'Refunds post a reversing ledger entry',
        status: 'adr accepted',
        updated: '2026-09-01',
      }),
    ]);
    expect(context.operations.map((doc) => doc.title)).toEqual(['Refund stuck in pending']);
    expect(context.owners).toContainEqual({
      team: 'Payments',
      owns: expect.arrayContaining(['PaymentService']),
    });
  });

  it('says how each relationship is known, and what nobody declared', () => {
    expect(context.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'consumes',
          to: 'service:LedgerService',
          evidence: ['declared', 'observed'],
        }),
        expect.objectContaining({ to: 'service:Analytics', evidence: ['observed'] }),
        expect.objectContaining({ type: 'produces', evidence: ['declared'] }),
      ]),
    );
    expect(context.gaps).toEqual(
      expect.arrayContaining([
        'Analytics consumes Payment refunded was seen in traces, but nobody declared it.',
        'PaymentService produces Payment refunded is declared but was not in the supplied traces; they do not establish whether it still happens.',
      ]),
    );
  });

  it('admits when nothing matches, instead of returning the nearest thing', () => {
    const none = taskContext(graph, 'customer onboarding');

    expect(none.matches).toEqual([]);
    expect(none.gaps[0]).toMatch(/^Nothing in the catalog is named for customer, onboarding\./);
  });

  it('says when no decision explains the matched resources', () => {
    expect(taskContext(graph, 'order placed').gaps).toContain(
      'No decision record is about these resources: the reasons behind the current design are not in the catalog.',
    );
  });
});

describe('taskContext word matching', () => {
  it('matches a word to its other forms', () => {
    const graph: ResourceGraph = {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        resource({ kind: 'service', id: 'notifications-retry' }, 'notifications-retry'),
        resource({ kind: 'service', id: 'payroll' }, 'payroll'),
      ],
      relationships: [],
    };

    expect(taskContext(graph, 'how are notifications retried').matches).toEqual([
      { key: 'service:notifications-retry', matched: ['notifications', 'retried'] },
    ]);
    expect(taskContext(graph, 'pay').matches).toEqual([]);
  });
});

describe('taskContext business vocabulary', () => {
  const term: CatalogResource['ref'] = {
    kind: 'term',
    namespace: 'identity/customers',
    id: 'customer-onboarding',
  };

  const identity: CatalogResource['ref'] = { kind: 'service', id: 'IdentityService' };

  const decision: CatalogResource['ref'] = {
    kind: 'document',
    namespace: 'identity',
    id: 'adr/0004-verify-before-account',
  };

  const graph: ResourceGraph = {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [
      resource(term, 'Customer onboarding', {
        summary: 'Everything between sign-up and a verified account.',
        attributes: { domain: 'customers', aliases: ['KYC', 'sign-up'] },
      }),
      resource(identity, 'IdentityService', { owner: { team: 'Identity' } }),
      resource(decision, 'Verify identity before opening an account', {
        attributes: {
          repository: 'identity',
          updated: '2026-07-01',
          kind: 'adr',
          status: 'accepted',
        },
      }),
      resource({ kind: 'term', namespace: 'identity/customers', id: 'churn' }, 'Churn'),
    ],
    relationships: [
      { type: 'describes', from: term, to: identity, provenance: 'declared', needsReview: false },
      {
        type: 'describes',
        from: decision,
        to: identity,
        provenance: 'declared',
        needsReview: false,
      },
    ],
  };

  it('finds a term by an alias, and what implements it with the decisions about that', () => {
    const context = taskContext(graph, 'How does KYC work?');

    expect(context.vocabulary).toEqual([
      expect.objectContaining({ title: 'Customer onboarding', aliases: ['KYC', 'sign-up'] }),
    ]);
    expect(context.services.map((service) => service.title)).toEqual(['IdentityService']);
    expect(context.decisions.map((doc) => doc.title)).toEqual([
      'Verify identity before opening an account',
    ]);
    expect(context.owners).toEqual([{ team: 'Identity', owns: ['IdentityService'] }]);
  });

  it('says when a term names nothing that implements it', () => {
    expect(taskContext(graph, 'reduce churn').gaps).toContain(
      'Churn: in the glossary, but its about: names nothing that implements it.',
    );
  });
});

describe('taskContext evidence strength and completeness', () => {
  const event: CatalogResource['ref'] = {
    kind: 'event',
    namespace: 'orders/orders',
    id: 'order.placed',
  };

  const consumers: CatalogResource['ref'][] = Array.from({ length: 5 }, (_, index) => ({
    kind: 'service',
    id: `Consumer${index}`,
  }));

  const graph: ResourceGraph = {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [resource(event, 'Order placed'), ...consumers.map((ref) => resource(ref, ref.id))],
    relationships: [
      ...consumers.slice(0, 4).map((to) => ({
        type: 'consumes' as const,
        from: event,
        to,
        provenance: 'declared' as const,
        needsReview: false,
      })),
      {
        type: 'consumes' as const,
        from: event,
        to: consumers[4]!,
        provenance: 'observed',
        needsReview: true,
        attributes: { attribution: 'reported' },
      },
    ],
  };

  it('calls a consumer a runtime source only reported "reported", not observed', () => {
    const context = taskContext(graph, 'order placed');

    expect(context.relationships.find((edge) => edge.to === 'service:Consumer4')).toEqual({
      from: 'event:orders%2Forders/order.placed',
      type: 'consumes',
      to: 'service:Consumer4',
      evidence: ['reported'],
    });
    expect(context.gaps).toContain(
      'Consumer4 consumes Order placed was reported by a runtime source, but no delivery was observed and nobody declared it.',
    );
    // A report is not a trace, so declared edges are not called unseen.
    expect(context.gaps.join(' ')).not.toMatch(/not in the supplied traces/);
  });

  it('says what the limit left out, and returns it when asked', () => {
    const short = taskContext(graph, 'order placed', { limit: 2 });

    expect(short.services).toHaveLength(2);
    expect(short.omitted).toEqual({ services: 3, relationships: 1 });
    expect(short.gaps.at(-1)).toBe(
      'Not everything fits: 1 more relationships, 3 more services left out. Call again with a higher limit before treating these lists as complete.',
    );

    const full = taskContext(graph, 'order placed', { limit: 5 });

    expect(full.services).toHaveLength(5);
    expect(full.omitted).toBeUndefined();
  });
});
