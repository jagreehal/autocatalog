/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataProductsPage } from './DataProductsPage';

const meta = {
  title: 'Pages/DataProductsPage',
  component: DataProductsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    products: [
      {
        name: 'Daily revenue',
        summary: 'What was captured each day.',
        repository: 'payments-service',
        domain: 'payments',
        inputs: 1,
        outputs: 1,
        href: '/data-products/payments-service/daily-revenue/',
      },
    ],
  },
} satisfies Meta<typeof DataProductsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoDataProducts: Story = { args: { products: [] } };
