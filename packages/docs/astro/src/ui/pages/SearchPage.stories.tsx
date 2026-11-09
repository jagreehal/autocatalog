/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '#ui/components/ui/button.tsx';
import { SearchPage } from './SearchPage';

const meta = {
  title: 'Pages/SearchPage',
  component: SearchPage,
  parameters: { layout: 'fullscreen' },
  args: {
    query: 'refund pay',
    words: ['refund', 'pay'],
    total: 2,
    results: [
      {
        title: 'Refund policy',
        href: '/billing/refunds/',
        excerpt: 'A refund is paid back to the card that made the payment, within five days.',
      },
      {
        title: 'Payment completed',
        href: '/events/payments/payments/payment.completed/',
        excerpt: 'Emitted once a payment has been captured. Refunds follow as their own event.',
      },
    ],
  },
} satisfies Meta<typeof SearchPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** More matched than are shown. */
export const Truncated: Story = { args: { total: 48 } };

export const NoQuery: Story = { args: { query: '', words: [], results: [], total: 0 } };

export const NoResults: Story = {
  args: { query: 'chargeback', words: ['chargeback'], results: [], total: 0 },
};

/** The site's assistant offered when nothing matches. */
export const NoResultsAskAssistant: Story = {
  args: {
    ...NoResults.args,
    empty: <Button variant="outline">Ask the assistant</Button>,
  },
};
