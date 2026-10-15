import { describe, expect, it } from 'vitest';
import { eventFrontmatter, indexFields, type JsonObject } from 'autocatalog-core';
import type { CatalogEvent } from '../src/catalog';
import { eventPath, eventsForService, fieldCarriers } from '../src/event-path';

// payment.completed in the payment domain, published by two repositories that
// share neither schema nor services.
const published = (
  repository: string,
  producers: string[],
  properties: JsonObject,
  extra: { name?: string; version?: string } = {},
): CatalogEvent => ({
  repository,
  event: {
    folder: {
      path: `/${repository}/events/payment/payment.completed`,
      defaultDomain: 'payment',
      isVersioned: false,
      parentEventPath: null,
    },
    frontmatter: {
      ...eventFrontmatter.parse({
        id: 'payment.completed',
        version: '1.0.0',
        name: 'Payment Completed',
        summary: 'A payment was captured.',
        producers,
        consumers: [],
        ...extra,
      }),
      domain: 'payment',
    },
    body: '',
    schemaPath: 'schema.json',
    schema: { type: 'object', properties, required: Object.keys(properties) },
    examples: [],
  },
});

const payments = published('payments-service', ['payments-api'], {
  amount: { type: 'number' },
});

const legacy = published('legacy-billing', ['billing-batch'], { amount: { type: 'string' } });

const events = [payments, legacy];

describe('a service lists each published event that names it, once', () => {
  it('keeps repository identity through produces and consumes', () => {
    expect(eventsForService(events, 'payments-api', 'producers')).toEqual([payments]);
    expect(eventsForService(events, 'billing-batch', 'producers')).toEqual([legacy]);
    expect(eventsForService(events, 'payments-api', 'consumers')).toEqual([]);
  });

  it('gives two repositories naming the same service one entry each, under their own name', () => {
    const v1 = published('a', ['shared'], {}, { name: 'Payment Completed', version: '1.0.0' });
    const v2 = published('b', ['shared'], {}, { name: 'Payment Settled', version: '2.0.0' });

    const listed = eventsForService([v1, v2], 'shared', 'producers');
    expect(listed.map(({ repository, event }) => [repository, event.frontmatter.name])).toEqual([
      ['a', 'Payment Completed'],
      ['b', 'Payment Settled'],
    ]);
  });
});

describe('each field occurrence links to the schema it came from', () => {
  it('lines up occurrences of the same id from two repositories with their own pages', () => {
    const [amount] = indexFields(events.map(({ event }) => event));
    const carriers = fieldCarriers(events).get(amount!.path)!;

    expect(amount!.occurrences.map((o) => o.type)).toEqual(['number', 'string']);
    expect(carriers.map(eventPath)).toEqual([
      'events/payments-service/payment/payment.completed/',
      'events/legacy-billing/payment/payment.completed/',
    ]);
  });
});
