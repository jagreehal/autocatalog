/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { OwnerPage } from './OwnerPage';

const meta = {
  title: 'Pages/OwnerPage',
  component: OwnerPage,
  parameters: { layout: 'fullscreen' },
  args: {
    contact: 'mailto:payments@example.com',
    sections: [
      {
        kind: 'document',
        heading: 'Documents',
        resources: [
          {
            kind: 'document',
            title: 'Payments runbook',
            href: '/payments/runbook',
            namespace: 'payments',
            summary: 'What to do when payments stop completing.',
          },
          {
            kind: 'document',
            title: 'Refund policy',
            href: '/payments/refunds',
            namespace: 'payments',
          },
        ],
      },
      {
        kind: 'event',
        heading: 'Events',
        resources: [
          {
            kind: 'event',
            title: 'Payment completed',
            href: '/events/payments/payments/payment.completed/',
            namespace: 'payments/payments',
            summary: 'A payment was captured.',
          },
          {
            kind: 'event',
            title: 'Refund issued',
            href: '/events/payments/payments/refund.issued/',
            namespace: 'payments/payments',
          },
          {
            kind: 'event',
            title: 'Payment failed',
            href: '/events/payments/payments/payment.failed/',
            namespace: 'payments/payments',
            summary: 'The card issuer declined, or the capture timed out.',
          },
        ],
      },
      {
        kind: 'service',
        heading: 'Services',
        resources: [
          {
            kind: 'service',
            title: 'PaymentService',
            href: '/services/payments/payment-service/',
            namespace: 'payments',
            summary: 'Captures card payments and emits their outcome.',
          },
        ],
      },
    ],
  },
} satisfies Meta<typeof OwnerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoContact: Story = { args: { contact: undefined } };

export const OwnsNothingYet: Story = { args: { contact: undefined, sections: [] } };
