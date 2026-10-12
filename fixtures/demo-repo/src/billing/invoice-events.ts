import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

// Wart: deprecated event with a declared replacement.
export const InvoiceRaised = defineEvent(
  {
    id: 'invoice.raised',
    version: '1.1.0',
    name: 'Invoice Raised',
    summary: 'Legacy invoice event, superseded by payment.completed.',
    domain: 'billing',
    team: 'Billing',
    producers: ['InvoiceService'],
    consumers: ['LedgerService'],
    status: 'deprecated',
    deprecation: {
      since: '2026-05-01',
      replacedBy: { id: 'payment.completed', version: '2.0.0' },
      notes: 'Invoice settlement moved into the payments pipeline.',
    },
    example: { invoiceId: 'inv_9', amountMinor: 120000, raisedAt: '2026-04-30T09:00:00Z' },
  },
  z.object({
    invoiceId: z.string(),
    amountMinor: z.number().int(),
    raisedAt: z.string(),
  }),
);
