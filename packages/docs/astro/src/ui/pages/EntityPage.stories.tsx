/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EntityPage } from './EntityPage';

const meta = {
  title: 'Pages/EntityPage',
  component: EntityPage,
  parameters: { layout: 'fullscreen' },
  args: {
    repository: 'payments-service',
    file: 'entities/payment.md',
    aggregateRoot: true,
    identifier: 'paymentId',
    domains: [{ name: 'payments', href: '/domains/payments/' }],
    services: [{ name: 'PaymentService', href: '/services/PaymentService/' }],
    properties: [
      { name: 'paymentId', type: 'string', required: true, description: 'Unique.', properties: [] },
      {
        name: 'status',
        type: 'string',
        required: true,
        enum: ['authorised', 'captured'],
        properties: [],
      },
      {
        name: 'card',
        type: 'object',
        required: false,
        properties: [{ name: 'last4', type: 'string', required: false, properties: [] }],
      },
    ],
    carriedBy: [
      { name: 'Payment captured', href: '/events/payments-service/payments/payment.captured/' },
    ],
    diagram: null,
    narrativeHtml: '<p>A payment owns its refunds.</p>',
  },
} satisfies Meta<typeof EntityPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NotCarried: Story = { args: { carriedBy: [], aggregateRoot: false } };
