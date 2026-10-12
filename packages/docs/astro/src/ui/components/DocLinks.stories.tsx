/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DocLinks } from './DocLinks';

const meta = {
  title: 'Components/DocLinks',
  component: DocLinks,
  args: {
    related: [
      { id: 'billing/refunds', title: 'Refund policy', repo: 'billing', resolved: true },
      { id: 'orders/runbook', title: 'Orders runbook', repo: 'orders', resolved: true },
    ],
    linkedFrom: [
      { id: 'platform/oncall', title: 'On-call handbook', repo: 'platform', resolved: true },
    ],
  },
} satisfies Meta<typeof DocLinks>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A target outside this checkout still shows, struck through and said so. */
export const UnresolvedTarget: Story = {
  args: {
    related: [
      { id: 'orders/runbook', title: 'Orders runbook', repo: 'orders', resolved: true },
      { id: 'legacy/payments', title: 'legacy/payments', repo: 'legacy', resolved: false },
    ],
    linkedFrom: [],
  },
};

/** A document with no edges either way draws nothing. */
export const Empty: Story = { args: { related: [], linkedFrom: [] } };
