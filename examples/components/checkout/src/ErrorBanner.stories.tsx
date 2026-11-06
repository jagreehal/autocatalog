import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBanner } from './ErrorBanner';

const meta = {
  title: 'Checkout/ErrorBanner',
  component: ErrorBanner,
} satisfies Meta<typeof ErrorBanner>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The message for any declined card. */
export const Declined: Story = { args: { message: 'Your card was declined.' } };

/** A retry button appears when the payment can be tried again. */
export const Retryable: Story = { args: { message: 'The bank timed out.', onRetry: () => {} } };
