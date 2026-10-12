import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent, getEventMetadata, mergeMetadata } from '../src/define-event';
import { explicitToAdapterEvent } from '../src/event-mapper';

describe('defineEvent', () => {
  it('returns the schema unchanged', () => {
    const schema = z.object({ id: z.string() });
    const result = defineEvent({ domain: 'payments' }, schema);
    expect(result).toBe(schema);
  });

  it('attaches metadata via symbol', () => {
    const schema = z.object({ id: z.string() });

    const result = defineEvent(
      {
        domain: 'payments',
        team: 'Billing',
        producers: ['PaySvc'],
        consumers: ['LedgerSvc'],
        tags: ['pci'],
      },
      schema,
    );

    const meta = getEventMetadata(result);
    expect(meta).toEqual({
      domain: 'payments',
      team: 'Billing',
      producers: ['PaySvc'],
      consumers: ['LedgerSvc'],
      tags: ['pci'],
    });
  });

  it('symbol is not attached to plain schemas', () => {
    const schema = z.object({ id: z.string() });
    expect(getEventMetadata(schema)).toBeUndefined();
  });

  it('returns undefined for a missing schema or plain JSON Schema', () => {
    expect(getEventMetadata(undefined)).toBeUndefined();
    expect(getEventMetadata({ type: 'object' })).toBeUndefined();
  });
});

describe('mergeMetadata', () => {
  it('returns undefined when both inputs are undefined', () => {
    expect(mergeMetadata(undefined, undefined)).toBeUndefined();
  });

  it('returns undefined when explicit is empty and schemaMeta is undefined', () => {
    expect(mergeMetadata({}, undefined)).toBeUndefined();
  });

  it('returns schemaMeta when explicit is undefined', () => {
    const schemaMeta = { domain: 'orders', team: 'Fulfillment' };
    expect(mergeMetadata(undefined, schemaMeta)).toEqual(schemaMeta);
  });

  it('returns explicit when schemaMeta is undefined', () => {
    const explicit = { domain: 'orders', producers: ['SvcA'] };
    expect(mergeMetadata(explicit, undefined)).toEqual(explicit);
  });

  it('explicit fields override schemaMeta fields', () => {
    const explicit = { domain: 'checkout', producers: ['CartService'] };
    const schemaMeta = { domain: 'payments', producers: ['LegacyService'], tags: ['pci'] };
    expect(mergeMetadata(explicit, schemaMeta)).toEqual({
      domain: 'checkout',
      producers: ['CartService'],
      tags: ['pci'],
    });
  });

  it('merges partial objects from both sides', () => {
    const explicit = { team: 'Billing' };
    const schemaMeta = { domain: 'orders', producers: ['CheckoutService'] };
    expect(mergeMetadata(explicit, schemaMeta)).toEqual({
      domain: 'orders',
      team: 'Billing',
      producers: ['CheckoutService'],
    });
  });
});

describe('delivery through defineEvent', () => {
  it('carries the delivery promise into the event, so the catalog entry has it', () => {
    const delivery = {
      guarantee: 'at-least-once',
      orderingKey: 'id',
      maxLateness: 'PT5M',
    } as const;

    const event = explicitToAdapterEvent({
      id: 'order.placed',
      version: '1.0.0',
      name: 'Order placed',
      summary: 's',
      examples: [],
      schema: defineEvent({ delivery }, z.object({ id: z.string() })),
    });

    expect(event.meta?.delivery).toEqual(delivery);
  });
});
