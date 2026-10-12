import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

// Wart: no example supplied — example generation (P4) should fill this in.
export const OrderPlaced = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    name: 'Order Placed',
    summary: 'A customer placed an order.',
    domain: 'orders',
    producers: ['OrderService'],
    consumers: ['PaymentService', 'WarehouseService'],
  },
  z.object({
    orderId: z.string(),
    customerId: z.string(),
    totalMinor: z.number().int(),
    lines: z.array(z.object({ sku: z.string(), quantity: z.number().int().positive() })),
  }),
);
