/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Evidence } from './Evidence';

const meta = {
  title: 'Components/Evidence',
  component: Evidence,
  args: {
    method: 'extracted',
    location: 'src/payments/events.ts:12',
    symbol: 'paymentCompleted',
    confidence: null,
    needsReview: false,
  },
} satisfies Meta<typeof Evidence>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Read out of code: a solid rule in the accent. */
export const Extracted: Story = {};

/** Written down by the event's owners, in its frontmatter or `defineEvent`. */
export const Declared: Story = {
  args: { method: 'declared', location: 'events/payment.completed/index.mdx:4', symbol: null },
};

/** A guess: the rule is dashed, so it reads without colour too. */
export const InferredNeedsReview: Story = {
  args: {
    method: 'inferred',
    location: 'src/payments/handlers.ts:48',
    symbol: 'onPaymentCompleted',
    confidence: 0.25,
    needsReview: true,
  },
};

export const Observed: Story = {
  args: { method: 'observed', location: null, symbol: null, basis: 'in 18,342 spans' },
};

/** No file to point at: it says what it was learned from instead. */
export const NoFileWithBasis: Story = {
  args: {
    method: 'inferred',
    location: null,
    symbol: null,
    confidence: 0.6,
    needsReview: true,
    basis: 'from the events that name it',
  },
};
