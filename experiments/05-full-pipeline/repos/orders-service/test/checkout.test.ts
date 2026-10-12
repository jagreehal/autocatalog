import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { flush, init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';
import { placeOrder } from '../src/orders.ts';

// The test run records what the service emitted, for the catalog to check.
const snapshot = new ArchitectureSnapshotSubscriber({ service: 'orders-service' });

init({ service: 'orders-service', subscribers: [snapshot] });

after(async () => {
  await flush();
  await snapshot.writeToFile('.autotel/snapshot.json');
});

test('places an order', () => {
  assert.equal(placeOrder({ orderId: 'o-1', total: 42, currency: 'GBP' }).orderId, 'o-1');
});

test('places a gift order', () => {
  const gift = placeOrder({ orderId: 'o-2', total: 10, currency: 'EUR', giftMessage: 'Enjoy' });
  assert.equal(gift.giftMessage, 'Enjoy');
});
