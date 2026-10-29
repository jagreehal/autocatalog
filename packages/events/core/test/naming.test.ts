import { expect, it } from 'vitest';
import { readsAsPastTense } from '../src/naming';

it('reads a past-tense id or name, however it is written', () => {
  for (const name of ['order.placed', 'PaymentSucceeded', 'invoice_sent', 'Card frozen'])
    expect(readsAsPastTense(name), name).toBe(true);

  for (const name of ['PlaceOrder', 'order.place', 'feed.refresh', 'payment', 'ShedLoad'])
    expect(readsAsPastTense(name), name).toBe(false);
});
