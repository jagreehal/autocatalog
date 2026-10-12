/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { flowVisualiser } from './fixtures';
import { ServicePage } from './ServicePage';

const meta = {
  title: 'Pages/ServicePage',
  component: ServicePage,
  parameters: { layout: 'fullscreen' },
  args: {
    flow: {
      from: [
        { label: 'Refund issued', href: '/events/payments/payments/refund.issued/', kind: 'event' },
      ],
      inbound: 'consumed by',
      centre: { label: 'LedgerService', kind: 'service' },
      outbound: 'produces',
      to: [
        {
          label: 'Payment completed',
          href: '/events/payments/payments/payment.completed/',
          kind: 'event',
        },
      ],
    },
    visualiser: flowVisualiser,
    sections: [
      {
        heading: 'Produces',
        slug: 'produces',
        events: [
          {
            name: 'Payment completed',
            id: 'payment.completed',
            domain: 'payments',
            href: '/events/payments/payments/payment.completed/',
            repository: 'payments',
          },
        ],
      },
      {
        heading: 'Consumes',
        slug: 'consumes',
        events: [
          {
            name: 'Refund issued',
            id: 'refund.issued',
            domain: 'payments',
            href: '/events/payments/payments/refund.issued/',
          },
        ],
      },
    ],
    documents: [{ href: '/payments/ledger-runbook', title: 'Ledger runbook', label: 'payments' }],
    owner: { team: 'Payments', href: '/owners/payments/' },
    system: 'Payment Processing',
  },
} satisfies Meta<typeof ServicePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLinkedDiagram: Story = {
  args: {
    diagram: {
      embed: false,
      iframeSrc: '/eventcatalog/services/LedgerService/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fservices%2FLedgerService%2F',
      title: 'LedgerService in EventCatalog',
    },
  },
};

export const NothingDeclared: Story = {
  args: {
    flow: {
      from: [],
      inbound: 'consumed by',
      centre: { label: 'LedgerService', kind: 'service' },
      outbound: 'produces',
      to: [],
    },
    visualiser: undefined,
    sections: [],
    documents: [],
  },
};
