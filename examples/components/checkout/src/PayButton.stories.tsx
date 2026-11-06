import type { Meta, StoryObj } from '@storybook/react-vite';
import { PayButton } from './PayButton';

const meta = {
  title: 'Checkout/PayButton',
  component: PayButton,
} satisfies Meta<typeof PayButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Ready to take the payment. */
export const Ready: Story = { args: { amount: '£42.00' } };

/** A payment is in flight. */
export const Busy: Story = { args: { amount: '£42.00', busy: true } };
