import { z } from 'zod';

export const LookupOrderInput = z.object({
  orderId: z.string().min(1),
});

export const LookupOrderOutput = z.object({
  orderId: z.string(),
  customerId: z.string(),
  status: z.enum(['placed', 'shipped', 'delivered', 'cancelled', 'refunded']),
  total: z.number(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  placedAt: z.string().datetime(),
});
