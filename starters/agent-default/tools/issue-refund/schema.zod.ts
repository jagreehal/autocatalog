import { z } from 'zod';

export const IssueRefundInput = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  reason: z.string().min(1).max(500),
});

export const IssueRefundOutput = z.object({
  refundId: z.string(),
  status: z.enum(['issued', 'pending', 'failed']),
  issuedAt: z.string().datetime(),
});
