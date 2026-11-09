/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesignsPage } from './DesignsPage';

const meta = {
  title: 'Pages/DesignsPage',
  component: DesignsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    designs: [
      {
        title: 'Refunds v2',
        summary: 'Refunds become their own service, with an event the ledger listens for.',
        repository: 'payments',
        status: 'proposed',
        changes: '1 new service, 1 new event and 3 new relations',
        href: '/designs/payments/refunds-v2/',
      },
      {
        title: 'Split shipping from orders',
        repository: 'orders',
        status: 'draft',
        changes: '2 new services',
        href: '/designs/orders/split-shipping/',
      },
    ],
  },
} satisfies Meta<typeof DesignsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { designs: [] } };
