/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DeliveryPath } from './DeliveryPath';

const meta = {
  title: 'Components/DeliveryPath',
  component: DeliveryPath,
  args: {
    complete: true,
    routes: [
      {
        consumer: 'LedgerService',
        environment: 'staging',
        hops: [
          { name: 'PaymentService', entity: 'service', href: '#' },
          { name: 'payments', entity: 'exchange' },
          {
            name: 'ledger.payments',
            entity: 'queue',
            rule: 'currency = GBP',
            source: 'infrastructure/rabbitmq/definitions.json:41',
          },
          { name: 'LedgerService', entity: 'service', href: '#' },
        ],
        examples: [
          { name: 'example-1', headers: 'currency = GBP', outcome: 'reaches' },
          { name: 'example-2', headers: 'currency = EUR', outcome: 'excluded' },
        ],
        deadLetter: { exchange: 'ledger.dead-letter', queues: ['ledger.dead-letter'] },
      },
    ],
    findings: [
      {
        confidence: 'possible',
        message:
          'the bindings to ledger.payments exclude the committed example example-2 (currency = EUR), so LedgerService would not receive it',
        source: 'infrastructure/rabbitmq/definitions.json:25',
      },
    ],
  },
} satisfies Meta<typeof DeliveryPath>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Routed: Story = {};

export const Broken: Story = {
  args: {
    complete: false,
    routes: [
      {
        consumer: 'LedgerService',
        environment: 'production',
        hops: [
          { name: 'PaymentService', entity: 'service', href: '#' },
          { name: 'payments', entity: 'exchange' },
        ],
        examples: [{ name: 'example-1', headers: 'currency = GBP', outcome: 'not evaluated' }],
        deadLetter: { exchange: 'ledger.dead-letter', queues: [] },
      },
    ],
    findings: [
      {
        confidence: 'confirmed',
        message:
          'queue ledger.payments dead-letters to exchange ledger.dead-letter, which routes nowhere, so a rejected message is dropped',
      },
      {
        confidence: 'unknown',
        message: 'payments: exchange type x-consistent-hash is not evaluated',
      },
    ],
  },
};
