import { schemaTree } from '../lib/schema-tree';
import type { DocListItem } from '../components/DocList';
import type { EventVersionsProps } from '../components/EventVersions';
import type { ExampleView } from '../components/Examples';
import type { FlowStripProps } from '../components/FlowStrip';
import type { RuntimeEvidenceView } from '../components/RuntimeEvidence';

// Props for the page stories: what the Astro routes would hand each page, kept
// small and in one place so the pages' variants differ only where they should.

export const docs: DocListItem[] = [
  {
    id: 'orders/runbook',
    repo: 'orders',
    title: 'Orders runbook',
    owner: 'orders-team',
    updated: '2026-09-14T10:00:00Z',
    tags: ['runbook', 'oncall'],
  },
  {
    id: 'billing/refunds',
    repo: 'billing',
    title: 'Refund policy',
    owner: 'billing-team',
    updated: null,
    tags: ['runbook'],
  },
];

export { emptyExplorerModel, explorerModel } from '../components/catalog-explorer.fixture';

/** The visualiser's input for the three resources above. */
export const flowVisualiser = {
  graph: {
    nodes: [
      { id: 'from-0', type: 'service' as const, label: 'PaymentService', metadata: {} },
      {
        id: 'centre',
        type: 'event' as const,
        label: 'Payment completed',
        metadata: { version: '2.0.0' },
      },
      { id: 'to-0', type: 'service' as const, label: 'LedgerService', metadata: {} },
    ],
    edges: [
      {
        id: 'e1',
        source: 'from-0',
        target: 'centre',
        type: 'publishes' as const,
        label: 'publishes',
      },
      {
        id: 'e2',
        source: 'centre',
        target: 'to-0',
        type: 'subscribes' as const,
        label: 'subscribed by',
      },
    ],
    options: { legend: true, search: false },
  },
  hrefs: { centre: '/events/payments/payments/payment.completed' },
};

export const eventFlow: Omit<FlowStripProps, 'label'> = {
  from: [{ label: 'PaymentService', href: '/services/PaymentService/', kind: 'service' }],
  inbound: 'publishes',
  centre: { label: 'Payment completed', detail: 'v2.0.0', kind: 'event' },
  outbound: 'subscribed by',
  to: [
    { label: 'LedgerService', href: '/services/LedgerService/', kind: 'service' },
    { label: 'AuditService', href: '/services/AuditService/', kind: 'service' },
  ],
};

export const schema = schemaTree({
  type: 'object',
  required: ['id', 'amount', 'currency'],
  properties: {
    id: { type: 'string', description: 'The payment id.' },
    amount: { type: 'number', exclusiveMinimum: 0 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    completedAt: { type: 'string', format: 'date-time' },
  },
});

export const examples: ExampleView[] = [
  {
    name: 'captured',
    code: JSON.stringify({ id: 'pay_1', amount: 12.5, currency: 'GBP' }, null, 2),
  },
];

export const evidence: RuntimeEvidenceView = {
  status: 'snapshot',
  ref: 'payments/payment.completed',
  caveat:
    'A consumer absent from the evidence is not proof it is gone. Counts may be sampled and describe observations, not continuous coverage.',
  count: 18342,
  observedRange: { firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-10-09T23:59:00Z' },
  snapshot: { generatedAt: '2026-10-10T08:00:00Z' },
  declaredConsumers: ['LedgerService', 'AuditService'],
  observedConsumers: ['LedgerService'],
  additionalConsumers: [],
  neverObserved: ['AuditService'],
  consumerEvidence: 'observed',
  sources: [{ producer: 'PaymentService', channel: 'payments.completed', count: 18342 }],
  consumerOutcomes: [],
  deadLetters: [],
  sampleTraceIds: ['4bf92f3577b34da6a3ce929d0e0e4736'],
};

export const noEvidence: RuntimeEvidenceView = {
  status: 'no-evidence',
  ref: 'payments/payment.completed',
  caveat: 'No runtime evidence is attached. This does not mean the event has no traffic.',
  deadLetters: [],
};

export const versions: EventVersionsProps['versions'] = [
  {
    href: '/events/payments/payments/payment.completed/',
    label: 'v2.0.0',
    current: true,
    active: true,
    changesHtml:
      '<h3>Changes since v1.0.0</h3><ul><li>Added <code>currency</code> (required)</li></ul>',
  },
  {
    href: '/events/payments/payments/payment.completed/v/1.0.0/',
    label: 'v1.0.0',
    current: false,
    active: false,
  },
];
