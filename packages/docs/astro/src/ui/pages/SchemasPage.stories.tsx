/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SchemasPage } from './SchemasPage';

const meta = {
  title: 'Pages/SchemasPage',
  component: SchemasPage,
  parameters: { layout: 'fullscreen' },
  args: {
    schemas: [
      {
        name: 'Payment completed',
        id: 'payment.completed',
        version: '1.0.0',
        domain: 'payments',
        repository: 'payments',
        format: 'JSON Schema',
        owner: { team: 'payments', href: '/owners/payments/' },
        href: '/events/payments/payments/payment.completed/',
        schemaHref: '/events/payments/payments/payment.completed/schema.json',
        search: 'payment completed payment.completed payments json schema',
      },
      {
        name: 'Order placed',
        id: 'order.placed',
        version: '2.1.0',
        domain: 'orders',
        repository: 'orders',
        format: 'Avro',
        href: '/events/orders/orders/order.placed/',
        schemaHref: '/events/orders/orders/order.placed/schema.json',
        search: 'order placed order.placed orders avro',
      },
    ],
  },
} satisfies Meta<typeof SchemasPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSchemas: Story = { args: { schemas: [] } };
