import { schemaTree } from '../lib/schema-tree';
import type { DocListItem } from '../components/DocList';
import type { EventVersionsProps } from '../components/EventVersions';
import type { ExampleView } from '../components/Examples';
import type { FlowStripProps } from '../components/FlowStrip';
import type { RuntimeEvidenceView } from '../components/RuntimeEvidence';
import type { ChannelRow } from '../../channels';
import type { ComponentRow } from '../../components';
import type { McpServerRow } from '../../mcp-servers';
import type { SystemRow } from '../../systems';

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

export const observedChannel: ChannelRow = {
  id: 'payments.completed',
  href: '/channels/payments.completed/',
  system: 'Payments platform',
  bindings: ['PaymentService', 'LedgerService', 'AuditService'],
  source: 'observed',
};

export const designChannel: ChannelRow = {
  id: 'refunds.requested',
  href: '/channels/refunds.requested/',
  bindings: [],
  source: 'design',
  designHref: '/designs/payments/refunds-v2/',
};

export const channels: ChannelRow[] = [observedChannel, designChannel];

export const documentedComponent: ComponentRow = {
  id: 'web-ui/order-summary',
  name: 'OrderSummary',
  repository: 'web-ui',
  path: 'components/web-ui/order-summary/',
  href: '/components/web-ui/order-summary/',
  owner: { team: 'Checkout', href: '/owners/checkout/' },
  description: 'The basket total, delivery and tax, shown before payment.',
  import: "import { OrderSummary } from '@example/web-ui';",
  viewer: 'Storybook',
  props: [
    { name: 'order', type: 'Order', required: true, description: 'The order to total.' },
    { name: 'currency', type: "'GBP' | 'EUR' | 'USD'", required: false },
    { name: 'onEdit', type: '() => void', required: false },
  ],
  stories: [
    {
      id: 'default',
      name: 'Default',
      description: 'Three items with standard delivery.',
      snippet: '<OrderSummary order={order} />',
      href: 'https://storybook.example.com/?path=/story/ordersummary--default',
    },
    {
      id: 'empty',
      name: 'Empty basket',
      description: undefined,
      snippet: undefined,
      href: undefined,
    },
  ],
  alsoIn: ['admin-ui'],
};

export const bareComponent: ComponentRow = {
  id: 'admin-ui/refund-button',
  name: 'RefundButton',
  repository: 'admin-ui',
  path: 'components/admin-ui/refund-button/',
  href: '/components/admin-ui/refund-button/',
  owner: undefined,
  description: undefined,
  import: undefined,
  viewer: undefined,
  props: [],
  stories: [],
  alsoIn: [],
};

export const components: ComponentRow[] = [documentedComponent, bareComponent];

export const internalSystem: SystemRow = {
  id: 'payments-platform',
  name: 'Payments platform',
  href: '/systems/payments-platform/',
  external: false,
  summary: 'Takes card payments and keeps the ledger.',
  designHref: '/designs/payments/refunds-v2/',
  designTitle: 'Refunds v2',
  members: ['PaymentService', 'LedgerService', 'RefundService'],
};

export const externalSystem: SystemRow = {
  id: 'card-processor',
  name: 'Card processor',
  href: '/systems/card-processor/',
  external: true,
  designHref: '/designs/payments/refunds-v2/',
  designTitle: 'Refunds v2',
  members: [],
};

export const systems: SystemRow[] = [internalSystem, externalSystem];

export const builtMcpServer: McpServerRow = {
  id: 'orders-mcp',
  title: 'Orders MCP',
  href: '/mcp-servers/orders-mcp/',
  summary: 'Looks up orders and their shipments for support agents.',
  owners: ['orders-team'],
  origin: 'built',
  transport: 'streamable-http',
  endpoint: 'https://mcp.example.com/orders',
  versions: ['1.4.0'],
  builtIn: ['orders'],
  repositories: ['support-tools', 'orders'],
  agents: ['SupportAssistant'],
  tools: [
    { name: 'get_order', behaviour: 'read-only' },
    { name: 'cancel_order', behaviour: 'destructive' },
    { name: 'add_note', behaviour: 'changes data' },
    { name: 'search_orders', behaviour: undefined },
  ],
  connections: ['support-tools'],
  snapshotted: true,
  changes: [
    {
      at: '2026-10-28T09:12:00Z',
      connection: 'support-tools',
      tool: 'cancel_order',
      severity: 'breaking',
      summary: 'Now requires a reason.',
    },
    {
      at: '2026-10-02T14:30:00Z',
      connection: 'support-tools',
      tool: 'add_note',
      severity: 'info',
      summary: 'Added.',
    },
  ],
  needsReview: false,
};

export const unknownMcpServer: McpServerRow = {
  id: 'filesystem',
  title: 'filesystem',
  href: '/mcp-servers/filesystem/',
  owners: [],
  origin: 'third-party',
  transport: 'stdio',
  endpoint: 'npm:@modelcontextprotocol/server-filesystem',
  versions: [],
  builtIn: [],
  repositories: [],
  agents: [],
  tools: [],
  connections: [],
  snapshotted: false,
  changes: [],
  needsReview: true,
};

export const mcpServers: McpServerRow[] = [builtMcpServer, unknownMcpServer];
