import type { ExplorerModel } from './catalog-explorer-model';

// What `explorerModel` builds for a small graph: a payments service and a
// ledger service joined by one event. Written out by hand because the builder
// needs autocatalog-core, which a story, like the browser, cannot load.
export const explorerModel: ExplorerModel = {
  kinds: ['event', 'service'],
  countByKind: { event: 1, service: 2 },
  relationships: 2,
  review: 2,
  rows: [
    {
      key: 'event:payments/payment.completed',
      anchor: 'resource-event-payments-payment.completed',
      kind: 'event',
      title: 'Payment completed',
      href: '/events/payment.completed',
      summary: 'A payment was captured.',
      evidence: null,
      owner: 'payments',
      provenance: 'inferred',
      at: null,
      commit: null,
      needsReview: true,
      notableFields: [['version', 'inferred']],
      schemaJson:
        '{\n  "type": "object",\n  "properties": {\n    "id": { "type": "string" }\n  }\n}',
      connections: [
        {
          key: 'service:LedgerService--consumes-->event:payments/payment.completed',
          direction: 'in',
          type: 'consumes',
          provenance: 'declared',
          target: { title: 'LedgerService', anchor: 'resource-service-LedgerService' },
          targetKey: 'service:LedgerService',
          evidence: null,
        },
        {
          key: 'service:PaymentService--produces-->event:payments/payment.completed',
          direction: 'in',
          type: 'produces',
          provenance: 'declared',
          target: { title: 'PaymentService', anchor: 'resource-service-PaymentService' },
          targetKey: 'service:PaymentService',
          evidence: null,
        },
      ],
      searchText:
        'event payments payment.completed payment completed a payment was captured. payments',
    },
    {
      key: 'service:LedgerService',
      anchor: 'resource-service-LedgerService',
      kind: 'service',
      title: 'LedgerService',
      href: '/services/LedgerService',
      summary: null,
      evidence: null,
      owner: null,
      provenance: 'inferred',
      at: null,
      commit: null,
      needsReview: true,
      notableFields: [['owner', 'inferred']],
      schemaJson: null,
      connections: [
        {
          key: 'service:LedgerService--consumes-->event:payments/payment.completed',
          direction: 'out',
          type: 'consumes',
          provenance: 'declared',
          target: {
            title: 'Payment completed',
            anchor: 'resource-event-payments-payment.completed',
          },
          targetKey: 'event:payments/payment.completed',
          evidence: null,
        },
      ],
      searchText: 'service ledgerservice ledgerservice',
    },
    {
      key: 'service:PaymentService',
      anchor: 'resource-service-PaymentService',
      kind: 'service',
      title: 'PaymentService',
      href: '/services/PaymentService',
      summary: 'Captures card payments.',
      evidence: null,
      owner: 'payments',
      provenance: 'declared',
      at: 'src/payments/service.ts:3',
      commit: '0123456789abcdef',
      needsReview: false,
      notableFields: [],
      schemaJson: null,
      connections: [
        {
          key: 'service:PaymentService--produces-->event:payments/payment.completed',
          direction: 'out',
          type: 'produces',
          provenance: 'declared',
          target: {
            title: 'Payment completed',
            anchor: 'resource-event-payments-payment.completed',
          },
          targetKey: 'event:payments/payment.completed',
          evidence: null,
        },
      ],
      searchText: 'service paymentservice paymentservice captures card payments. payments',
    },
  ],
};

export const emptyExplorerModel: ExplorerModel = {
  kinds: [],
  countByKind: {},
  relationships: 0,
  review: 0,
  rows: [],
};
