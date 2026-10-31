import { describe, expect, it } from 'vitest';
import { schemaTree } from '../src/ui/lib/schema-tree';
import { fieldsByPath, withFieldLineage } from '../src/field-lineage';
import type { FieldSummary } from 'autocatalog-core';

describe('schemaTree paths', () => {
  it('names nested and array fields the way the field index does', () => {
    const nodes = schemaTree({
      type: 'object',
      properties: {
        amount: { type: 'integer' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' } },
          },
        },
      },
    });

    expect(nodes.map((node) => node.path)).toEqual(['amount', 'items']);
    expect(nodes[1]?.children?.[0]?.path).toBe('items[].sku');
  });
});

describe('withFieldLineage', () => {
  it('joins consumers onto matching property paths', () => {
    const field: FieldSummary = {
      path: 'amount',
      name: 'amount',
      occurrences: [
        {
          domain: 'payments',
          eventId: 'payment.completed',
          version: '1.0.0',
          type: 'integer',
          required: true,
          conditional: false,
          consumers: ['LedgerService'],
          producers: ['PaymentService'],
        },
      ],
      types: ['integer'],
      requiredIn: 1,
      consumers: ['LedgerService'],
      producers: ['PaymentService'],
      typeConflict: false,
      requiredConflict: false,
    };

    const [amount] = withFieldLineage(
      schemaTree({
        type: 'object',
        properties: { amount: { type: 'integer' } },
      }),
      fieldsByPath([field]),
    );

    expect(amount?.lineage).toEqual({
      carriers: 1,
      consumers: ['LedgerService'],
      producers: ['PaymentService'],
      conflict: undefined,
    });
  });
});
