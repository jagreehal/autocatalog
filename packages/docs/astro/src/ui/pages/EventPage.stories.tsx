/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventPage } from './EventPage';
import {
  changesHtml,
  evidence,
  eventFlow,
  examples,
  flowVisualiser,
  noEvidence,
  schema,
  versions,
} from './fixtures';

const meta = {
  title: 'Pages/EventPage',
  component: EventPage,
  parameters: { layout: 'fullscreen' },
  args: {
    owner: { team: 'payments', href: '/owners/payments/' },
    provenance: {
      method: 'extracted',
      location: 'src/events/payment.ts:12',
      symbol: 'paymentCompleted',
      confidence: 0.9,
      needsReview: false,
    },
    deprecation: null,
    narrativeHtml:
      '<p>Emitted once the acquirer confirms capture. <strong>Not</strong> on authorisation.</p>',
    flow: eventFlow,
    visualiser: flowVisualiser,
    schema,
    schemaHref: '/events/payments/payments/payment.completed/schema.json',
    evidence,
    examples,
    versions,
    changesHtml,
    documents: [{ href: '/payments/runbook', title: 'Payments runbook', label: 'payments' }],
    facts: [
      ['Id', 'payment.completed'],
      ['Domain', 'payments', '/domains/payments/'],
      ['Repository', 'payments'],
      ['Tags', 'payments, billing'],
    ],
    transport: [{ address: 'payments.completed', protocols: ['kafka'], deliveryMode: 'push' }],
    delivery: {
      guarantee: 'at-least-once',
      orderingKey: 'paymentId',
      idempotencyKey: 'paymentId',
      maxLateness: '5 minutes',
    },
    source: 'https://github.com/acme/payments/tree/main/events/payments/payment.completed',
    edit: 'https://github.com/acme/payments/edit/main/events/payments/payment.completed/index.mdx',
    diagram: {
      embed: false,
      iframeSrc: '/eventcatalog/events/payment.completed/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fevents%2Fpayment.completed%2F',
      title: 'Payment completed in EventCatalog',
    },
  },
} satisfies Meta<typeof EventPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Deprecated: Story = {
  args: { deprecation: 'Since 2.0.0. Use payment.captured. Consumers should migrate by Q1.' },
};

/** Still being written: published to read, flagged before anyone depends on it. */
export const Draft: Story = {
  args: { draft: true },
};

export const InlineDiagram: Story = {
  args: {
    diagram: {
      embed: true,
      iframeSrc: '/eventcatalog/events/payment.completed/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fevents%2Fpayment.completed%2F',
      title: 'Payment completed in EventCatalog',
    },
  },
};

/** Nothing optional: one version, no evidence, no owner, no location, no documents. */
export const Bare: Story = {
  args: {
    owner: undefined,
    provenance: {
      method: 'inferred',
      location: null,
      symbol: null,
      confidence: null,
      needsReview: true,
    },
    narrativeHtml: null,
    flow: { ...eventFlow, from: [], to: [] },
    visualiser: undefined,
    evidence: noEvidence,
    examples: [],
    versions: versions.slice(0, 1),
    changesHtml: null,
    documents: [],
    facts: [
      ['Id', 'payment.completed'],
      ['Domain', 'payments'],
      ['Repository', 'payments'],
    ],
    transport: undefined,
    delivery: undefined,
    source: null,
    edit: null,
    diagram: undefined,
  },
};
