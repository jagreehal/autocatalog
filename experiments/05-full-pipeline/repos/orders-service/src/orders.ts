import { track } from 'autotel';

export interface Order {
  orderId: string;
  total: number;
  currency: 'GBP' | 'EUR';
  giftMessage?: string;
}

/** Accept an order and announce it. Billing invoices from the event. */
export function placeOrder(order: Order): Order {
  track('order.placed', {
    ...order,
    _autotel: { producer: 'OrderService', channel: 'orders.events', consumers: ['BillingService'] },
  });

  return order;
}
