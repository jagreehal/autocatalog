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

/** Worst case: a long domain name, a domain with nothing in it yet, and counts in the thousands. */
export const WorstCase: Story = {
  args: {
    domains: [
      {
        name: 'customer-communication-preferences-and-consent',
        href: '/domains/customer-communication-preferences-and-consent/',
        events: 1284,
        services: 1,
        owners: 0,
      },
      { name: 'q', href: '/domains/q/', events: 0, services: 0, owners: 0 },
      {
        name: 'zahlungsverkehr',
        href: '/domains/zahlungsverkehr/',
        events: 1,
        services: 12,
        owners: 3,
      },
    ],
  },
};

/** One domain: every count reads in the singular. */
export const One: Story = {
  args: {
    domains: [{ name: 'orders', href: '/domains/orders/', events: 1, services: 1, owners: 1 }],
  },
};
