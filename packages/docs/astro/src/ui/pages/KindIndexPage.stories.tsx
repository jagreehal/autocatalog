/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KindIndexPage } from './KindIndexPage';

const adr = (
  id: string,
  title: string,
  status: string,
  date: string,
  repository = 'payments-service',
) => ({
  id: `${repository}/adr/${id}`,
  title,
  href: `/${repository}/adr/${id}/`,
  repository,
  status,
  cells: {
    status: { text: status, status: true },
    date: { text: date },
    owner: { text: 'Payments', href: '/owners/payments/' },
  },
});

const meta = {
  title: 'Pages/KindIndexPage',
  component: KindIndexPage,
  parameters: { layout: 'fullscreen' },
  args: {
    columns: [
      { field: 'status', heading: 'Status' },
      { field: 'date', heading: 'Date' },
      { field: 'owner', heading: 'Owner' },
    ],
    rows: [
      {
        ...adr(
          '0003-outbox',
          'Publish events through a transactional outbox',
          'proposed',
          '2 Oct 2026',
        ),
        summary: 'Removes the dual write between the ledger and Kafka.',
      },
      adr('0002-kafka', 'Use Kafka for payment events', 'accepted', '14 Mar 2026'),
      adr('0001-rabbitmq', 'Use RabbitMQ for payment events', 'superseded', '9 Jan 2025'),
      adr('0001-postgres', 'Keep reports in Postgres', 'accepted', '3 Dec 2024', 'reporter'),
    ],
    statuses: ['proposed', 'accepted', 'superseded'],
    repositories: ['payments-service', 'reporter'],
    chains: [
      [
        {
          title: 'Use RabbitMQ for payment events',
          href: '/payments-service/adr/0001-rabbitmq/',
          status: 'superseded',
        },
        {
          title: 'Use Kafka for payment events',
          href: '/payments-service/adr/0002-kafka/',
          status: 'accepted',
        },
      ],
    ],
  },
} satisfies Meta<typeof KindIndexPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Decisions: Story = {};

export const Incidents: Story = {
  args: {
    columns: [
      { field: 'status', heading: 'Status' },
      { field: 'severity', heading: 'Severity' },
      { field: 'date', heading: 'Date' },
    ],
    rows: [
      {
        id: 'payments-service/incidents/2026-09-14-duplicate-captures',
        title: 'Duplicate captures after a consumer rebalance',
        href: '/payments-service/incidents/2026-09-14-duplicate-captures/',
        summary: 'Idempotency keys now cover the retry path.',
        repository: 'payments-service',
        status: 'resolved',
        cells: {
          status: { text: 'resolved', status: true },
          severity: { text: 'sev2' },
          date: { text: '14 Sept 2026' },
        },
      },
      {
        id: 'payments-service/incidents/2026-10-02-ledger-lag',
        title: 'Ledger lag during month-end',
        href: '/payments-service/incidents/2026-10-02-ledger-lag/',
        repository: 'payments-service',
        status: 'open',
        cells: {
          status: { text: 'open', status: true },
          severity: null,
          date: { text: '2 Oct 2026' },
        },
      },
    ],
    statuses: ['open', 'resolved'],
    repositories: ['payments-service'],
    chains: [],
  },
};
