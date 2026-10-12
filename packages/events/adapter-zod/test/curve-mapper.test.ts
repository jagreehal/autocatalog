import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pascalCase } from 'autocatalog-core';
import { parseCurveName, curveItemToAutocatalogEvent } from '../src/curve-mapper';
import { defineEvent } from '../src/define-event';

describe('pascalCase', () => {
  it('converts dot-separated identifiers', () => {
    expect(pascalCase('payment.completed')).toBe('PaymentCompleted');
  });

  it('handles single segments', () => {
    expect(pascalCase('heartbeat')).toBe('Heartbeat');
  });

  it('handles dashes and underscores', () => {
    expect(pascalCase('payment-batch.completed')).toBe('PaymentBatchCompleted');
    expect(pascalCase('order_placed.v2')).toBe('OrderPlacedV2');
  });
});

describe('parseCurveName', () => {
  it('splits a curve-style name into version + id + domain + pascalName', () => {
    expect(parseCurveName('v1.payment.completed')).toEqual({
      version: 'v1',
      id: 'payment.completed',
      domain: 'payment',
      pascalName: 'PaymentCompleted',
    });
  });

  it('handles single-segment ids', () => {
    expect(parseCurveName('v2.heartbeat')).toEqual({
      version: 'v2',
      id: 'heartbeat',
      domain: 'heartbeat',
      pascalName: 'Heartbeat',
    });
  });

  it('handles dash-separated id segments', () => {
    expect(parseCurveName('v1.payment-batch.completed')).toEqual({
      version: 'v1',
      id: 'payment-batch.completed',
      domain: 'payment-batch',
      pascalName: 'PaymentBatchCompleted',
    });
  });

  it('rejects names without a version prefix', () => {
    expect(() => parseCurveName('payment.completed')).toThrow(/version/i);
  });
});

describe('curveItemToAutocatalogEvent', () => {
  it('maps a full curve item to an IR-shaped record', () => {
    const result = curveItemToAutocatalogEvent({
      name: 'v1.payment.completed',
      description: 'Fires when a payment completes',
      schema: { type: 'object' },
      example: { id: 'pay_1' },
    });

    expect(result.id).toBe('payment.completed');
    expect(result.version).toBe('v1');
    expect(result.name).toBe('Payment Completed');
    expect(result.summary).toBe('Fires when a payment completes');
    expect(result.domain).toBe('payment');
    expect(result.folderName).toBe('PaymentCompleted');
    expect(result.schema).toEqual({ type: 'object' });
    expect(result.examples).toEqual([{ name: 'default', data: { id: 'pay_1' } }]);
    expect(result.meta).toBeUndefined();
  });

  it('handles items with no example', () => {
    const result = curveItemToAutocatalogEvent({
      name: 'v1.heartbeat',
      description: 'tick',
      schema: { type: 'object' },
    });

    expect(result.examples).toEqual([]);
  });

  it('extracts metadata from a defineEvent-wrapped schema', () => {
    const schema = defineEvent(
      { domain: 'checkout', producers: ['CartService'], tags: ['critical'] },
      z.object({ orderId: z.string() }),
    );

    const result = curveItemToAutocatalogEvent({
      name: 'v1.checkout.orderPlaced',
      description: 'Order placed',
      schema,
    });

    expect(result.domain).toBe('checkout');
    expect(result.meta).toMatchObject({
      domain: 'checkout',
      producers: ['CartService'],
      tags: ['critical'],
    });
  });

  it('falls back to Curve domain when defineEvent has no domain', () => {
    const schema = defineEvent({ producers: ['ReportSvc'] }, z.object({}));

    const result = curveItemToAutocatalogEvent({
      name: 'v1.reports.generated',
      description: 'report ready',
      schema,
    });

    expect(result.domain).toBe('reports');
    expect(result.meta).toMatchObject({ producers: ['ReportSvc'] });
  });
});
