/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { docHead, eventHead } from './fixtures';
import { PageTitleChrome } from './PageTitleChrome';

// Starlight's own <h1> is Astro; a plain one stands in for it.
const meta = {
  title: 'Overrides/PageTitleChrome',
  component: PageTitleChrome,
  // On the site this renders outside Starlight's Markdown, unlike the preview.
  decorators: [
    (Story) => (
      <div className="not-content">
        <Story />
      </div>
    ),
  ],
  args: { ...eventHead, children: <h1>payment.completed</h1> },
} satisfies Meta<typeof PageTitleChrome>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Event: Story = {};

/** A draft with the badges its team gave it: the state is quiet, the labels plain. */
export const DraftWithBadges: Story = {
  args: {
    pills: [
      { text: 'v0.1.0' },
      { text: 'draft', tone: 'quiet' },
      { text: 'PCI' },
      { text: 'Beta' },
    ],
  },
};

/** A document: crumbs from its id, and a button that copies its Markdown twin. */
export const Document: Story = {
  args: { ...docHead, children: <h1>Payments service runbook</h1> },
};

/** A decision record: its state as a badge, then its kind, date, scope and succession. */
export const Decision: Story = {
  args: {
    ...docHead,
    kindLabel: 'Decisions',
    catalogKey: 'document:payments-service/adr/0002-kafka',
    summary: 'Payment events move from RabbitMQ to Kafka, keyed by payment id.',
    status: 'accepted',
    facts: [
      { term: 'Kind', links: [{ label: 'Decisions', href: '/decisions/' }] },
      { term: 'Date', text: '14 Mar 2026' },
      {
        term: 'Applies to',
        links: [
          { label: 'service/PaymentService', href: '/services/PaymentService/' },
          {
            label: 'event/payments/payment.completed',
            href: '/events/payments-service/payments/payment.completed/',
          },
        ],
      },
      {
        term: 'Supersedes',
        links: [
          { label: 'Use RabbitMQ for payment events', href: '/payments-service/adr/0001-rabbitmq' },
        ],
      },
    ],
    children: <h1>Use Kafka for payment events</h1>,
  },
};

/** An incident: an open state is the one a reader acts on, and its fix gets a line. */
export const Incident: Story = {
  args: {
    ...docHead,
    kindLabel: 'Incidents',
    catalogKey: 'document:payments-service/incidents/2026-09-14-duplicate-captures',
    summary: undefined,
    status: 'resolved',
    facts: [
      { term: 'Kind', links: [{ label: 'Incidents', href: '/incidents/' }] },
      { term: 'Date', text: '14 Sept 2026' },
      { term: 'Severity', text: 'sev2' },
      {
        term: 'Root cause',
        text: 'A consumer rebalance replayed captures the ledger had already applied.',
      },
      {
        term: 'Solution',
        text: 'Idempotency keys now cover the retry path, checked before the write.',
      },
    ],
    children: <h1>Duplicate captures after a consumer rebalance</h1>,
  },
};

/** An index page: no kind, a call to action level with the title. */
export const IndexWithPrimaryAction: Story = {
  args: {
    kind: undefined,
    kindLabel: undefined,
    catalogKey: undefined,
    summary: 'Every resource this build found, with how it was found.',
    pills: [],
    actions: [],
    primary: { label: 'Explore catalog', href: '/catalog/' },
    children: <h1>Knowledge graph</h1>,
  },
};

export const TitleOnly: Story = {
  args: {
    kind: undefined,
    kindLabel: undefined,
    catalogKey: undefined,
    summary: undefined,
    pills: [],
    actions: [],
    children: <h1>Getting started</h1>,
  },
};
