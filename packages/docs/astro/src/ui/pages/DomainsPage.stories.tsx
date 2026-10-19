/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DomainsPage } from './DomainsPage';

const meta = {
  title: 'Pages/DomainsPage',
  component: DomainsPage,
  parameters: { layout: 'fullscreen' },
  args: {
    domains: [
      { name: 'orders', href: '/domains/orders/', events: 4, services: 3, owners: 1 },
      { name: 'payments', href: '/domains/payments/', events: 2, services: 2, owners: 2 },
    ],
  },
} satisfies Meta<typeof DomainsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoDomains: Story = { args: { domains: [] } };
