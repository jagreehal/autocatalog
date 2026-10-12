/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Examples } from './Examples';

const meta = {
  title: 'Components/Examples',
  component: Examples,
  args: {
    examples: [
      {
        name: 'card-payment.json',
        code: '{\n  "paymentId": "pay_123",\n  "amount": 4200,\n  "currency": "GBP"\n}',
      },
    ],
  },
} satisfies Meta<typeof Examples>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Single: Story = {};

export const Several: Story = {
  args: {
    examples: [
      {
        name: 'card-payment.json',
        code: '{\n  "paymentId": "pay_123",\n  "amount": 4200,\n  "currency": "GBP"\n}',
      },
      {
        name: 'partial-refund.json',
        code: '{\n  "paymentId": "pay_123",\n  "amount": -1200,\n  "currency": "GBP",\n  "reason": "Item returned within 30 days of purchase, refunded to the original card"\n}',
      },
    ],
  },
};

/** The happy path, then the edge cases a consumer has to handle, each said plainly. */
export const EdgeCases: Story = {
  args: {
    examples: [
      {
        name: 'card-payment',
        title: 'A card payment',
        code: '{\n  "paymentId": "pay_123",\n  "amount": 4200\n}',
      },
      {
        name: 'redelivered',
        case: 'duplicate',
        summary: 'A repeat consumers must recognise',
        code: '{\n  "paymentId": "pay_123",\n  "amount": 4200\n}',
      },
      {
        name: 'after-outage',
        case: 'late',
        summary: 'Arrives after events that happened after it',
        code: '{\n  "paymentId": "pay_097",\n  "amount": 900\n}',
      },
      {
        name: 'no-amount',
        case: 'invalid',
        summary: 'Missing the amount the schema requires, so consumers reject it',
        code: '{\n  "paymentId": "pay_124"\n}',
      },
    ],
  },
};

/** With nothing to show, the card is not drawn. */
export const Empty: Story = { args: { examples: [] } };
