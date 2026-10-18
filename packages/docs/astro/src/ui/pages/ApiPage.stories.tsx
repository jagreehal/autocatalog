/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiPage } from './ApiPage';

const meta = {
  title: 'Pages/ApiPage',
  component: ApiPage,
  parameters: { layout: 'fullscreen' },
  args: {
    version: '1.0.0',
    repository: 'payments',
    file: 'contracts/openapi.json',
    specHref: '/apis/payments/openapi/openapi.json',
    services: [{ name: 'payments-service', href: '/services/payments-service/' }],
    operations: [
      { method: 'POST', path: '/payments', summary: 'Take a payment', deprecated: false },
      { method: 'GET', path: '/payments/{id}', summary: 'Read a payment', deprecated: false },
      { method: 'DELETE', path: '/payments/{id}', deprecated: true },
    ],
  },
} satisfies Meta<typeof ApiPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Unmatched: Story = { args: { version: undefined, services: [] } };
