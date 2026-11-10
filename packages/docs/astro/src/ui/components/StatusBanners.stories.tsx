/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { statusBanners } from '../../resource-status';
import { StatusBanners } from './StatusBanners';

const meta = {
  title: 'Components/StatusBanners',
  component: StatusBanners,
  args: {
    banners: statusBanners({
      status: 'deprecated',
      deprecation: 'Use payment.captured instead. Removed after 1 March 2027.',
    }),
  },
} satisfies Meta<typeof StatusBanners>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Deprecated: Story = {};

export const Draft: Story = { args: { banners: statusBanners({ status: 'draft' }) } };

/** Every banner at once, newest version first. */
export const All: Story = {
  args: {
    banners: statusBanners({
      status: 'deprecated',
      needsReview: true,
      newer: { version: '2.0.0', href: '/events/payments/payments/payment.completed/' },
    }),
  },
};

/** Nothing to say, so nothing renders. */
export const None: Story = { args: { banners: [] } };
