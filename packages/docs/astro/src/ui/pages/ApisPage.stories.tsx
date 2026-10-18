/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApisPage } from './ApisPage';

const meta = {
  title: 'Pages/ApisPage',
  component: ApisPage,
  parameters: { layout: 'fullscreen' },
  args: {
    apis: [
      {
        title: 'Payments Service API',
        version: '1.0.0',
        repository: 'payments',
        file: 'contracts/openapi.json',
        href: '/apis/payments/openapi/',
        operations: 2,
      },
      {
        title: 'Ledger webhooks',
        repository: 'ledger',
        file: 'contracts/webhooks.yaml',
        href: '/apis/ledger/webhooks/',
        operations: 0,
      },
    ],
  },
} satisfies Meta<typeof ApisPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoApis: Story = { args: { apis: [] } };
