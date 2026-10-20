/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RetirementsPage } from './RetirementsPage';

const meta = {
  title: 'Pages/Retirements',
  component: RetirementsPage,
  args: {
    retirements: [
      {
        event: 'payments/payment.completed',
        field: 'amount',
        verdict: 'blocked',
        name: 'Payment Completed',
        repository: 'payments-service',
        href: '#',
        runtime: 'seen (snapshot, last seen 2026-10-01)',
        gaps: [],
        consumers: [
          {
            consumer: 'LedgerService',
            standing: 'reads',
            href: '#',
            evidence: [{ source: 'payments-service', says: 'reads amount', standing: 'reads' }],
          },
          {
            consumer: 'FraudService',
            standing: 'unknown',
            href: '#',
            evidence: [
              { source: 'snapshot', says: 'seen receiving the event', standing: 'unknown' },
            ],
          },
          {
            consumer: 'BillingService',
            standing: 'clear',
            href: '#',
            evidence: [
              {
                source: 'payments-service',
                says: 'reads paymentId, not amount',
                standing: 'clear',
              },
            ],
          },
        ],
        next: [
          'LedgerService moves off amount',
          'Find out whether FraudService needs amount: it receives the event and declares nothing',
        ],
      },
    ],
  },
} satisfies Meta<typeof RetirementsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Blocked: Story = {};

export const Nothing: Story = { args: { retirements: [] } };
