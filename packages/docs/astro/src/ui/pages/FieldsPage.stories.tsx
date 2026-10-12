/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldsPage } from './FieldsPage';

const meta = {
  title: 'Pages/FieldsPage',
  component: FieldsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    eventCount: 2,
    conflicts: 1,
    eventsHref: '/catalog/?kind=event',
    fields: [
      {
        path: 'id',
        conflict: null,
        types: ['string'],
        carriers: [
          {
            eventId: 'payment.completed',
            href: '/events/payments/payments/payment.completed/',
            optional: false,
          },
          {
            eventId: 'refund.issued',
            href: '/events/payments/payments/refund.issued/',
            optional: false,
          },
        ],
        consumers: [{ name: 'LedgerService', href: '/services/LedgerService/' }],
        search: 'id payment.completed refund.issued ledgerservice paymentservice',
      },
      {
        path: 'amount',
        conflict: 'types differ: number | string',
        types: ['number', 'string'],
        carriers: [
          {
            eventId: 'payment.completed',
            href: '/events/payments/payments/payment.completed/',
            optional: false,
          },
          {
            eventId: 'refund.issued',
            href: '/events/billing/payments/refund.issued/',
            repository: 'billing',
            optional: true,
          },
        ],
        consumers: [],
        search: 'amount payment.completed refund.issued paymentservice',
      },
      {
        path: 'customer.email',
        conflict: null,
        types: ['string'],
        carriers: [
          {
            eventId: 'payment.completed',
            href: '/events/payments/payments/payment.completed/',
            optional: true,
          },
        ],
        consumers: [
          { name: 'LedgerService', href: '/services/LedgerService/' },
          { name: 'AuditService', href: '/services/AuditService/' },
        ],
        search: 'customer.email payment.completed ledgerservice auditservice',
      },
    ],
  },
} satisfies Meta<typeof FieldsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoConflicts: Story = {
  args: { conflicts: 0, fields: meta.args.fields.filter((field) => !field.conflict) },
};

export const Empty: Story = {
  args: { eventCount: 0, conflicts: 0, fields: [] },
};
