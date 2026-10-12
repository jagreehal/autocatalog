import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

export const PaymentCompleted = defineEvent(
  {
    id: 'payment.completed',
    version: '2.0.0',
    name: 'Payment Completed',
    summary: 'A payment has been authorised, captured, and settled.',
    domain: 'payments',
    team: 'Billing',
    producers: ['PaymentService'],
    consumers: ['LedgerService', 'NotificationService'],
    tags: ['pci', 'critical'],
    example: {
      paymentId: 'pay_042',
      amountMinor: 4999,
      currency: 'GBP',
      settledAt: '2026-07-01T10:30:00Z',
    },
  },
  z.object({
    paymentId: z.string(),
    amountMinor: z.number().int(),
    currency: z.string().length(3),
    settledAt: z.string(),
  }),
);
