/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RuntimeEvidence } from './RuntimeEvidence';

const caveat =
  'A consumer absent from the evidence is not proof it is gone. Reported consumer metadata is not proof of delivery. First/last seen describe observations, not continuous coverage; counts may be sampled. Environment, release and backend identity are not established by this snapshot.';

const meta = {
  title: 'Components/RuntimeEvidence',
  component: RuntimeEvidence,
  args: {
    evidence: {
      status: 'snapshot',
      ref: 'payments/payment.completed',
      caveat,
      count: 18342,
      observedRange: { firstSeen: '2026-09-01T00:00:00Z', lastSeen: '2026-10-09T23:59:00Z' },
      snapshot: { generatedAt: '2026-10-10T08:00:00Z' },
      declaredConsumers: ['LedgerService', 'NotificationService'],
      observedConsumers: ['LedgerService', 'AuditService'],
      additionalConsumers: ['AuditService'],
      neverObserved: ['NotificationService'],
      consumerEvidence: 'observed',
      sources: [{ producer: 'PaymentService', channel: 'payments.completed', count: 18342 }],
      consumerOutcomes: [],
      deadLetters: [],
      sampleTraceIds: ['4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7'],
    },
  },
} satisfies Meta<typeof RuntimeEvidence>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoEvidence: Story = {
  args: {
    evidence: {
      status: 'no-evidence',
      ref: 'payments/payment.completed',
      caveat: 'No runtime evidence is attached. This does not mean the event has no traffic.',
      deadLetters: [{ consumer: 'LedgerService', queue: 'ledger-dlq', maxAttempts: 3 }],
    },
  },
};

/** A consumer that retried, gave up and dead-lettered, with the reason it recorded. */
export const DeadLetters: Story = {
  args: {
    evidence: {
      ...meta.args.evidence,
      consumerOutcomes: [
        {
          consumer: 'LedgerService',
          count: 6,
          failed: 4,
          retried: 2,
          deadLettered: 1,
          replayed: 1,
          deadLetterReasons: [
            {
              reason: 'payment provider unavailable',
              category: 'transient',
              queue: 'ledger-dlq',
              count: 1,
            },
          ],
        },
      ],
      deadLetters: [{ consumer: 'LedgerService', queue: 'ledger-dlq', maxAttempts: 3 }],
    },
  },
};
