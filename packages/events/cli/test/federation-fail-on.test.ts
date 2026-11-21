import { expect, it } from 'vitest';
import { failingFindings, type FederationStatus } from '../src/federation';

const status: FederationStatus = {
  sources: [],
  duplicates: [],
  unresolved: ['orders: payments/refund.issued'],
  gateway: ['edge: route orders forwards to orders, whose API the catalog does not have'],
  unpinned: [],
  network: ['web → orders: the orders policy does not let web in'],
  behind: [],
  failures: [],
};

it('fails only on the kinds of finding named, each said under its kind', () => {
  expect(failingFindings(status, [])).toEqual([]);
  expect(failingFindings(status, ['gateway', 'network'])).toEqual([
    'gateway: edge: route orders forwards to orders, whose API the catalog does not have',
    'network: web → orders: the orders policy does not let web in',
  ]);
  expect(failingFindings(status, ['behind'])).toEqual([]);
});
