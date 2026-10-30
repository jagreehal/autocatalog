/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataProductPage } from './DataProductPage';

const meta = {
  title: 'Pages/DataProductPage',
  component: DataProductPage,
  parameters: { layout: 'fullscreen' },
  args: {
    repository: 'payments-service',
    file: 'data-products/daily-revenue.md',
    domain: { name: 'payments', href: '/domains/payments/' },
    visualiser: {
      graph: {
        nodes: [
          { id: 'event', type: 'event', label: 'Payment captured', metadata: {} },
          { id: 'product', type: 'data-product', label: 'Daily revenue', metadata: {} },
        ],
        edges: [
          { id: 'e', source: 'event', target: 'product', type: 'reads-from', label: 'feeds' },
        ],
      },
      hrefs: {},
    },
    inputs: [
      {
        name: 'Payment captured',
        href: '/events/payments-service/payments/payment.captured/',
        reference: 'event/payments/payment.captured',
      },
    ],
    outputs: [
      {
        name: 'LedgerService',
        reference: 'service/LedgerService',
        contract: 'contracts/daily-revenue.schema.json',
      },
    ],
    narrativeHtml: null,
  },
} satisfies Meta<typeof DataProductPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoDomain: Story = { args: { domain: undefined } };
