/** @jsxImportSource react */
import type { ReactNode } from 'react';

/*
 * The home page's map: an example company, acme, with four repositories that
 * carry the catalog topic. Every name and number here is illustrative; what is
 * real is the shape of it, the kinds of facts the catalog shows and where each
 * one comes from.
 */

export type Provenance = 'extracted' | 'declared' | 'inferred';

export type NodeKind = 'service' | 'event' | 'doc' | 'api' | 'table';

export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapNode {
  kind: NodeKind;
  /** Shown on the node; the id when absent. */
  label?: string;
  sub?: string;
  /** The centre of the node, in map units. */
  x: number;
  y: number;
  w: number;
}

export interface MapEdge {
  from: string;
  to: string;
  provenance: Provenance;
  /** Pull request #482 renames a field these consumers read. */
  breaking?: true;
  path: string;
  /** A stub from a service's spine to something it owns, drawn without an arrow. */
  stub?: true;
}

export interface Fact {
  label: string;
  value: ReactNode;
  provenance: Provenance;
  /** Where the value came from, after the provenance word. */
  how: ReactNode;
  /** The source line replaces the provenance word entirely. */
  plain?: true;
  badge?: 'Needs review' | 'Suspicious';
}

export interface FactSheet {
  kind: string;
  title?: string;
  key: string;
  summary: string;
  facts: Fact[];
  /** The facts as pull request #482 would change them. */
  prFacts?: Fact[];
  /** What the pull request does to this resource. */
  prAlert?: ReactNode;
}

export const VIEW = { width: 1110, height: 548 };

export const regions: Region[] = [
  { name: 'payments-service', x: 20, y: 24, w: 560, h: 400 },
  { name: 'ledger', x: 610, y: 24, w: 480, h: 290 },
  { name: 'notifications', x: 610, y: 344, w: 250, h: 186 },
  { name: 'reporter', x: 890, y: 344, w: 200, h: 186 },
];

export const nodes = new Map<string, MapNode>(
  Object.entries({
    PaymentService: { kind: 'service', x: 150, y: 125, w: 200, sub: 'Billing' },
    'payment.completed': { kind: 'event', x: 460, y: 125, w: 200 },
    'payment.refunded': { kind: 'event', x: 460, y: 205, w: 200 },
    'payments-api': {
      kind: 'api',
      label: 'Payments API',
      sub: 'OpenAPI 3.1',
      x: 202.5,
      y: 215,
      w: 225,
    },
    'replay-payment-events': {
      kind: 'doc',
      label: 'Replay payment events',
      sub: 'runbook, sev2',
      x: 202.5,
      y: 285,
      w: 225,
    },
    'adr-0003': {
      kind: 'doc',
      label: 'Kafka for payment events',
      sub: 'ADR 0003, accepted',
      x: 202.5,
      y: 355,
      w: 225,
    },
    LedgerService: { kind: 'service', x: 715, y: 105, w: 190, sub: 'Ledger' },
    'ledger.entry.posted': { kind: 'event', x: 970, y: 105, w: 210 },
    'incident-0914': {
      kind: 'doc',
      label: 'Duplicate ledger entries',
      sub: 'incident, resolved',
      x: 772.5,
      y: 190,
      w: 225,
    },
    statements: {
      kind: 'table',
      label: 'statements',
      sub: 'collection, Prisma',
      x: 755,
      y: 254,
      w: 190,
    },
    NotificationService: { kind: 'service', x: 735, y: 450, w: 210, sub: 'Messaging' },
    ReporterService: { kind: 'service', x: 990, y: 450, w: 180, sub: 'Finance data' },
  }),
);

export const nodeHeight = (id: string) => {
  const kind = nodes.get(id)!.kind;

  return kind === 'service' ? 50 : kind === 'event' ? 40 : 44;
};

type Side = 'l' | 'r' | 't' | 'b';

function port(id: string, side: Side, offset = 0): [number, number, number, number] {
  const node = nodes.get(id)!;
  const halfH = nodeHeight(id) / 2;
  const halfW = node.w / 2;

  if (side === 'r') return [node.x + halfW, node.y + offset, 1, 0];

  if (side === 'l') return [node.x - halfW, node.y + offset, -1, 0];

  if (side === 'b') return [node.x + offset, node.y + halfH, 0, 1];

  return [node.x + offset, node.y - halfH, 0, -1];
}

/** A straight line when the ports align, otherwise a curve leaving each port square. */
function curve(from: ReturnType<typeof port>, to: ReturnType<typeof port>) {
  const [x1, y1, dx1, dy1] = from;
  const [x2, y2, dx2, dy2] = to;

  if (x1 === x2 || y1 === y2) return `M${x1} ${y1} L${x2} ${y2}`;
  const k = Math.max(36, Math.hypot(x2 - x1, y2 - y1) * 0.42);

  return `M${x1} ${y1} C${x1 + dx1 * k} ${y1 + dy1 * k} ${x2 + dx2 * k} ${y2 + dy2 * k} ${x2} ${y2}`;
}

const link = (
  from: string,
  fromSide: Side,
  to: string,
  toSide: Side,
  provenance: Provenance,
  options: { fromOffset?: number; toOffset?: number; breaking?: true } = {},
): MapEdge => ({
  from,
  to,
  provenance,
  ...(options.breaking && { breaking: true }),
  path: curve(port(from, fromSide, options.fromOffset), port(to, toSide, options.toOffset)),
});

/** What hangs off a service: a spine down its left edge, one stub per attachment. */
const trays: Array<{ service: string; x: number; items: Array<[string, Provenance]> }> = [
  {
    service: 'PaymentService',
    x: 66,
    items: [
      ['payments-api', 'extracted'],
      ['replay-payment-events', 'declared'],
      ['adr-0003', 'declared'],
    ],
  },
  {
    service: 'LedgerService',
    x: 640,
    items: [
      ['incident-0914', 'declared'],
      ['statements', 'extracted'],
    ],
  },
];

export const spines = trays.map(({ service, x, items }) => {
  const top = nodes.get(service)!.y + nodeHeight(service) / 2;
  const bottom = nodes.get(items.at(-1)![0])!.y;

  return { key: service, path: `M${x} ${top}V${bottom}` };
});

export const joints = trays.flatMap(({ x, items }) =>
  items.map(([id, provenance]) => ({ key: id, x, y: nodes.get(id)!.y, provenance })),
);

export const edges: MapEdge[] = [
  link('PaymentService', 'r', 'payment.completed', 'l', 'extracted'),
  link('PaymentService', 'r', 'payment.refunded', 'l', 'extracted'),
  link('payment.completed', 'r', 'LedgerService', 'l', 'declared', { breaking: true }),
  link('payment.completed', 'r', 'NotificationService', 'l', 'declared', {
    breaking: true,
    toOffset: -8,
  }),
  link('payment.refunded', 'r', 'NotificationService', 'l', 'declared', { toOffset: 8 }),
  link('LedgerService', 'r', 'ledger.entry.posted', 'l', 'extracted'),
  link('ledger.entry.posted', 'b', 'ReporterService', 't', 'declared', {
    fromOffset: 60,
    toOffset: 40,
  }),
  link('statements', 'r', 'ReporterService', 't', 'inferred', { toOffset: -40 }),
  ...trays.flatMap(({ service, x, items }) =>
    items.map(([id, provenance]): MapEdge => {
      const node = nodes.get(id)!;

      return {
        from: service,
        to: id,
        provenance,
        stub: true,
        path: `M${x} ${node.y}H${node.x - node.w / 2}`,
      };
    }),
  ),
];

export const regionOf = (id: string) => {
  const { x, y } = nodes.get(id)!;

  return regions.find((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h)?.name ?? '';
};

const c = (text: string) => <code>{text}</code>;

const inDefineEvent = <>in {c('defineEvent()')}</>;

const fromGit = 'from git history';

const breakingAlert = (
  <>
    It consumes payment.completed, whose field {c('amount')} looks renamed to {c('amountMinor')}.
  </>
);

export const facts = new Map<string, FactSheet>(
  Object.entries({
    'payment.completed': {
      kind: 'Event',
      key: 'event:payments/payment.completed',
      summary: 'Emitted once a card payment settles.',
      facts: [
        {
          label: 'Schema',
          value: (
            <>
              {c('id')}, {c('amount')}, {c('currency')}, {c('completedAt')}
            </>
          ),
          provenance: 'extracted',
          how: <>from Zod in {c('src/events/payment-completed.ts:7')}</>,
        },
        { label: 'Producers', value: 'PaymentService', provenance: 'declared', how: inDefineEvent },
        {
          label: 'Consumers',
          value: 'LedgerService, NotificationService',
          provenance: 'declared',
          how: inDefineEvent,
        },
        {
          label: 'Owner',
          value: 'Billing',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
        {
          label: 'Version',
          value: '1.0.0',
          provenance: 'inferred',
          how: 'because none was declared',
          badge: 'Needs review',
        },
      ],
      prFacts: [
        {
          label: 'Schema',
          value: (
            <>
              {c('id')}, <code className="text-muted-foreground line-through">amount</code>{' '}
              <code className="text-destructive">amountMinor</code>, {c('currency')},{' '}
              {c('completedAt')}
            </>
          ),
          provenance: 'extracted',
          how: <>from Zod in {c('src/events/payment-completed.ts:7')}</>,
        },
        { label: 'Producers', value: 'PaymentService', provenance: 'declared', how: inDefineEvent },
        {
          label: 'Consumers',
          value: 'LedgerService, NotificationService',
          provenance: 'declared',
          how: inDefineEvent,
        },
        {
          label: 'Owner',
          value: 'Billing',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
        {
          label: 'Version',
          value: '1.0.0',
          provenance: 'inferred',
          how: 'Suspicious: the schema changed but the version stayed at 1.0.0.',
          plain: true,
          badge: 'Suspicious',
        },
      ],
      prAlert: (
        <>
          Field {c('amount')} (number) looks renamed to {c('amountMinor')}. Keep {c('amount')}{' '}
          alongside it until consumers move off it, or bump to 2.0.0.
        </>
      ),
    },
    'payment.refunded': {
      kind: 'Event',
      key: 'event:payments/payment.refunded',
      summary: 'Emitted when a refund is issued against a payment.',
      facts: [
        {
          label: 'Schema',
          value: (
            <>
              {c('id')}, {c('paymentId')}, {c('amount')}, {c('reason')}
            </>
          ),
          provenance: 'extracted',
          how: <>from {c('contracts/payment-refunded.json')}</>,
        },
        {
          label: 'Producers',
          value: 'PaymentService',
          provenance: 'declared',
          how: <>under {c('x-autocatalog')}</>,
        },
        {
          label: 'Consumers',
          value: 'NotificationService',
          provenance: 'declared',
          how: <>under {c('x-autocatalog')}</>,
        },
        {
          label: 'Version',
          value: '2.1.0',
          provenance: 'declared',
          how: <>under {c('x-autocatalog')}</>,
        },
      ],
    },
    PaymentService: {
      kind: 'Service',
      key: 'service:PaymentService',
      summary: 'Built from the events and documents that name it. Nobody wrote this page.',
      facts: [
        {
          label: 'Produces',
          value: 'payment.completed, payment.refunded',
          provenance: 'declared',
          how: 'on each event as a producer',
        },
        {
          label: 'API',
          value: 'Payments API',
          provenance: 'extracted',
          how: <>from the title of {c('contracts/payments.openapi.yaml')}</>,
        },
        {
          label: 'Documents',
          value: 'Replay payment events, Kafka for payment events',
          provenance: 'declared',
          how: <>in each document’s {c('about:')}</>,
        },
        {
          label: 'Owner',
          value: 'Billing',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
        {
          label: 'Reads',
          value: <>collection {c('payments')}</>,
          provenance: 'extracted',
          how: <>from the Mongoose model in {c('src/models/payment.ts')}</>,
        },
      ],
    },
    'payments-api': {
      kind: 'API',
      title: 'Payments API',
      key: '/apis/payments-service/payments-api/',
      summary: 'An API reference at /apis/payments-service/payments-api/, with the spec beside it.',
      facts: [
        {
          label: 'Spec',
          value: 'OpenAPI 3.1',
          provenance: 'extracted',
          how: <>from {c('contracts/payments.openapi.yaml')}</>,
        },
        {
          label: 'Owner',
          value: 'Billing',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
        {
          label: 'Applies to',
          value: 'PaymentService',
          provenance: 'extracted',
          how: 'from the spec’s title, which names the service',
        },
        { label: 'Changed', value: '2026-10-17', provenance: 'extracted', how: fromGit },
      ],
    },
    'replay-payment-events': {
      kind: 'Runbook',
      title: 'Replay payment events',
      key: 'document:payments-service/runbooks/replay-payment-events',
      summary: 'How to republish payment events after a consumer outage.',
      facts: [
        {
          label: 'Kind',
          value: 'runbook',
          provenance: 'extracted',
          how: <>from the folder {c('docs/runbooks/')}</>,
        },
        { label: 'Owner', value: 'Billing', provenance: 'declared', how: <>in {c('owner:')}</> },
        {
          label: 'Status',
          value: 'sev2, last tested 2026-09-02',
          provenance: 'declared',
          how: (
            <>
              in {c('severity:')} and {c('lastTested:')}
            </>
          ),
        },
        {
          label: 'Applies to',
          value: 'PaymentService, payment.completed',
          provenance: 'declared',
          how: <>in {c('about:')}</>,
        },
        { label: 'Changed', value: '2026-10-12', provenance: 'extracted', how: fromGit },
      ],
    },
    'adr-0003': {
      kind: 'Decision',
      title: 'Kafka for payment events',
      key: 'document:payments-service/adr/0003-kafka-for-payment-events',
      summary: 'Publish payment events on Kafka instead of RabbitMQ.',
      facts: [
        {
          label: 'Kind',
          value: 'adr',
          provenance: 'extracted',
          how: <>from the folder {c('docs/adr/')}</>,
        },
        {
          label: 'Owner',
          value: 'payments-platform',
          provenance: 'declared',
          how: <>in {c('owner:')}</>,
        },
        {
          label: 'Status',
          value: 'accepted, 2026-03-14',
          provenance: 'declared',
          how: (
            <>
              in {c('status:')} and {c('date:')}
            </>
          ),
        },
        {
          label: 'Supersedes',
          value: '0001 RabbitMQ for payment events',
          provenance: 'declared',
          how: <>in {c('supersedes:')}</>,
        },
        {
          label: 'Applies to',
          value: 'PaymentService, payment.completed',
          provenance: 'declared',
          how: <>in {c('about:')}</>,
        },
      ],
    },
    LedgerService: {
      kind: 'Service',
      key: 'service:LedgerService',
      summary: 'Posts double-entry records for settled payments.',
      facts: [
        {
          label: 'Consumes',
          value: 'payment.completed',
          provenance: 'declared',
          how: <>in payments-service, {inDefineEvent}</>,
        },
        {
          label: 'Produces',
          value: 'ledger.entry.posted',
          provenance: 'declared',
          how: 'in the Pydantic model’s config',
        },
        {
          label: 'Writes',
          value: <>collection {c('statements')}</>,
          provenance: 'extracted',
          how: <>from the Prisma schema in {c('prisma/schema.prisma')}</>,
        },
        {
          label: 'Incidents',
          value: 'Duplicate ledger entries',
          provenance: 'declared',
          how: <>in the incident’s {c('about:')}</>,
        },
        {
          label: 'Owner',
          value: 'Ledger',
          provenance: 'extracted',
          how: <>from {c('catalog-info.yaml')}</>,
        },
      ],
      prAlert: breakingAlert,
    },
    'ledger.entry.posted': {
      kind: 'Event',
      key: 'event:ledger/ledger.entry.posted',
      summary: 'One balanced journal entry was written.',
      facts: [
        {
          label: 'Schema',
          value: (
            <>
              {c('entryId')}, {c('accountId')}, {c('amountMinor')}, {c('postedAt')}
            </>
          ),
          provenance: 'extracted',
          how: <>from Pydantic in {c('ledger/events.py:14')}</>,
        },
        {
          label: 'Producers',
          value: 'LedgerService',
          provenance: 'declared',
          how: 'in the model’s config',
        },
        {
          label: 'Consumers',
          value: 'ReporterService',
          provenance: 'declared',
          how: <>in reporter’s {c('autocatalog.consumes.json')}</>,
        },
        {
          label: 'Owner',
          value: 'Ledger',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
      ],
    },
    'incident-0914': {
      kind: 'Incident',
      title: 'Duplicate ledger entries',
      key: 'document:ledger/incidents/2026-09-14-duplicate-ledger-entries',
      summary: 'A consumer rebalance replayed payment.completed and some payments posted twice.',
      facts: [
        {
          label: 'Kind',
          value: 'incident',
          provenance: 'extracted',
          how: <>from the folder {c('docs/incidents/')}</>,
        },
        { label: 'Owner', value: 'Ledger', provenance: 'declared', how: <>in {c('owner:')}</> },
        {
          label: 'Status',
          value: 'resolved, sev2, 2026-09-14',
          provenance: 'declared',
          how: (
            <>
              in {c('status:')}, {c('severity:')} and {c('date:')}
            </>
          ),
        },
        {
          label: 'Root cause',
          value: 'The consumer committed its offset after posting.',
          provenance: 'declared',
          how: <>in {c('rootCause:')}</>,
        },
        {
          label: 'Applies to',
          value: 'LedgerService, payment.completed',
          provenance: 'declared',
          how: <>in {c('about:')}</>,
        },
        { label: 'Changed', value: '2026-09-16', provenance: 'extracted', how: fromGit },
      ],
    },
    statements: {
      kind: 'Data model',
      title: 'statements',
      key: '/data/ledger/statements/',
      summary: 'Monthly account statements the ledger writes.',
      facts: [
        {
          label: 'Model',
          value: <>7 fields, key {c('id')}</>,
          provenance: 'extracted',
          how: <>from {c('prisma/schema.prisma:12')}</>,
        },
        {
          label: 'Owner',
          value: 'Ledger',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
        {
          label: 'Written by',
          value: 'LedgerService',
          provenance: 'extracted',
          how: 'from the Prisma client in ledger',
        },
        {
          label: 'Read by',
          value: 'ReporterService',
          provenance: 'inferred',
          how: 'from a trace, and nobody declared it',
          badge: 'Needs review',
        },
      ],
    },
    NotificationService: {
      kind: 'Service',
      key: 'service:NotificationService',
      summary: 'Sends receipts and refund emails.',
      facts: [
        {
          label: 'Consumes',
          value: 'payment.completed, payment.refunded',
          provenance: 'declared',
          how: 'on each event as a consumer',
        },
        {
          label: 'Repository',
          value: 'acme/notifications',
          provenance: 'extracted',
          how: 'from the git remote',
        },
        {
          label: 'Owner',
          value: 'Messaging',
          provenance: 'extracted',
          how: <>from {c('CODEOWNERS')}</>,
        },
      ],
      prAlert: breakingAlert,
    },
    ReporterService: {
      kind: 'Service',
      key: 'service:ReporterService',
      summary: 'Builds the nightly finance report.',
      facts: [
        {
          label: 'Consumes',
          value: 'ledger.entry.posted',
          provenance: 'declared',
          how: <>in {c('autocatalog.consumes.json')}</>,
        },
        {
          label: 'Also reads',
          value: <>collection {c('statements')}</>,
          provenance: 'inferred',
          how: 'from a trace, and nobody declared it',
          badge: 'Needs review',
        },
        {
          label: 'Owner',
          value: 'Finance data',
          provenance: 'extracted',
          how: <>from {c('catalog-info.yaml')}</>,
        },
      ],
    },
  }),
);
