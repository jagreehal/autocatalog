import { track } from 'autotel';

export interface Order {
  orderId: string;
  total: number;
  currency: 'GBP' | 'EUR';
  giftMessage?: string;
}

/**
 * The same service after a change nobody wrote down: every order now carries
 * a `couponCode`, and a suspicious one is also flagged.
 */
export function placeOrder(order: Order): Order {
  track('order.placed', {
    ...order,
    couponCode: 'NONE',
    _autotel: { producer: 'OrderService', channel: 'orders.events', consumers: ['BillingService'] },
  });

  if (order.total > 20) {
    track('order.flagged', {
      orderId: order.orderId,
      _autotel: { producer: 'OrderService', channel: 'orders.events' },
    });
  }

  return order;
}
