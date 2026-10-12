/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Code } from './Code';

const meta = {
  title: 'Components/Code',
  component: Code,
  args: {
    language: 'json',
    label: 'Example payload',
    code: JSON.stringify(
      {
        paymentId: 'pay_01HZX8',
        amount: 4200,
        currency: 'GBP',
        capturedAt: '2026-10-11T09:24:00Z',
        customer: { id: 'cus_93', email: 'ada@example.com', vip: false },
      },
      null,
      2,
    ),
  },
} satisfies Meta<typeof Code>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Json: Story = {};

export const TypeScript: Story = {
  args: {
    language: 'typescript',
    label: 'Event definition',
    code: `import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

// Captured once the acquirer confirms; never on authorisation.
export const paymentCaptured = defineEvent(
  { id: 'payment.captured', domain: 'payments', version: '2.0.0' },
  z.object({ paymentId: z.string(), amount: z.number().int().positive() }),
);`,
  },
};
