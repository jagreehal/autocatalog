/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DomainPage } from './DomainPage';
import { flowVisualiser } from './fixtures';

const meta = {
  title: 'Pages/DomainPage',
  component: DomainPage,
  parameters: { layout: 'fullscreen' },
  args: {
    summary: 'Taking money and giving it back.',
    events: [
      {
        name: 'Payment completed',
        id: 'payment.completed',
        href: '/events/payments/payments/payment.completed/',
        summary: 'A payment was captured.',
      },
      {
        name: 'Refund issued',
        id: 'refund.issued',
        href: '/events/payments/payments/refund.issued/',
      },
    ],
    services: [
      { name: 'LedgerService', href: '/services/LedgerService/', produces: 0, consumes: 2 },
      { name: 'PaymentService', href: '/services/PaymentService/', produces: 2, consumes: 0 },
    ],
    owners: [{ team: 'Payments', href: '/owners/payments/' }, { team: 'acme/finance' }],
    visualiser: flowVisualiser,
  },
} satisfies Meta<typeof DomainPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoMapOrOwners: Story = {
  args: { summary: undefined, visualiser: undefined, owners: [] },
};
