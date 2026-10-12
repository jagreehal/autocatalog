import { describe, expect, it } from 'vitest';
import { guaranteedFieldPaths, indexFields, searchFields } from '../src/fields';
import type { JsonObject, JsonValue } from '../src/json';
import type { LoadedEvent } from '../src/load';
import { eventFrontmatter } from '../src/schema';

function event(id: string, schema: JsonObject, consumers: string[] = []): LoadedEvent {
  return {
    folder: {
      path: `/tmp/${id}`,
      defaultDomain: 'payments',
      isVersioned: false,
      parentEventPath: null,
    },
    frontmatter: {
      ...eventFrontmatter.parse({
        id,
        version: '1.0.0',
        name: id,
        summary: id,
        consumers,
        producers: ['CheckoutService'],
      }),
      domain: 'payments',
    },
    body: '',
    schemaPath: `/tmp/${id}/schema.json`,
    schema,
    examples: [],
  };
}

const completed = event(
  'payment.completed',
  {
    type: 'object',
    required: ['customerId', 'payment'],
    properties: {
      customerId: { type: 'string' },
      payment: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'number' } },
      },
      items: {
        type: 'array',
        items: { type: 'object', properties: { sku: { type: 'string' } } },
      },
    },
  },
  ['LedgerService', 'NotificationService'],
);

const refunded = event(
  'payment.refunded',
  {
    type: 'object',
    properties: { customerId: { type: 'string' } },
  },
  ['LedgerService'],
);

describe('indexFields', () => {
  it('walks nested objects and array items into dotted paths', () => {
    const paths = indexFields([completed]).map((f) => f.path);
    expect(paths).toContain('payment.amount');
    expect(paths).toContain('items[].sku');
  });

  it('unions the consumers of every event carrying the field', () => {
    const customerId = indexFields([completed, refunded]).find((f) => f.path === 'customerId')!;
    expect(customerId.occurrences).toHaveLength(2);
    expect(customerId.consumers).toEqual(['LedgerService', 'NotificationService']);
  });

  it('flags a field that is required in one event and optional in another', () => {
    const customerId = indexFields([completed, refunded]).find((f) => f.path === 'customerId')!;
    expect(customerId.requiredConflict).toBe(true);
    expect(customerId.requiredIn).toBe(1);
    expect(customerId.typeConflict).toBe(false);
  });

  it('flags a field carrying different types across events', () => {
    const stringly = event('payment.legacy', {
      type: 'object',
      properties: { customerId: { type: 'number' } },
    });

    const customerId = indexFields([completed, stringly]).find((f) => f.path === 'customerId')!;
    expect(customerId.typeConflict).toBe(true);
    expect(customerId.types).toEqual(['number', 'string']);
  });

  it('indexes fields declared only inside a discriminated union', () => {
    // The shape `z.discriminatedUnion('kind', [...])` emits.
    const placed = event('order.placed', {
      type: 'object',
      required: ['orderId'],
      properties: { orderId: { type: 'string' } },
      $defs: { sku: { type: 'string' } },
      oneOf: [
        {
          type: 'object',
          required: ['kind', 'shippingAddress'],
          properties: {
            kind: { const: 'physical' },
            shippingAddress: {
              type: 'object',
              properties: { country: { type: 'string' } },
            },
            lineItems: {
              type: 'array',
              items: { type: 'object', properties: { sku: { $ref: '#/$defs/sku' } } },
            },
          },
        },
        {
          type: 'object',
          required: ['kind'],
          allOf: [{ properties: { kind: { const: 'digital' }, downloadUrl: { type: 'string' } } }],
        },
      ],
    });

    const fields = new Map(indexFields([placed]).map((f) => [f.path, f.occurrences[0]!]));
    expect([...fields.keys()]).toEqual(
      expect.arrayContaining(['shippingAddress.country', 'lineItems[].sku', 'downloadUrl']),
    );
    expect(fields.get('lineItems[].sku')!.type).toBe('string');
    expect(fields.get('orderId')).toMatchObject({ required: true, conditional: false });
    // Every branch declares and requires the discriminator.
    expect(fields.get('kind')).toMatchObject({ required: true, conditional: false });
    expect(fields.get('shippingAddress')).toMatchObject({ required: false, conditional: true });
    expect(fields.get('downloadUrl')!.conditional).toBe(true);
  });

  it('stops at a recursive $ref instead of walking forever', () => {
    const tree = event('tree.changed', {
      $defs: {
        node: {
          type: 'object',
          properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
        },
      },
      $ref: '#/$defs/node',
    });

    expect(indexFields([tree]).map((f) => f.path)).toEqual(['children']);
  });

  it('matches on the final segment as well as the full path', () => {
    const all = indexFields([completed]);
    expect(searchFields(all, 'amount').map((f) => f.path)).toEqual(['payment.amount']);
    expect(searchFields(all, 'payment.').map((f) => f.path)).toEqual(['payment.amount']);
  });
});

describe('guaranteedFieldPaths', () => {
  it('keeps only fields every valid payload carries', () => {
    const schema: JsonObject = {
      type: 'object',
      required: ['id', 'customer', 'items'],
      properties: {
        id: { type: 'string' },
        note: { type: 'string' },
        customer: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        items: {
          type: 'array',
          items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } },
        },
      },
      // Only one branch carries `refundId`, so a payload may not.
      oneOf: [
        { required: ['refundId'], properties: { refundId: { type: 'string' } } },
        { properties: { reason: { type: 'string' } } },
      ],
    };

    expect([...guaranteedFieldPaths(schema)].sort()).toEqual([
      'customer',
      'customer.id',
      'id',
      'items',
    ]);
  });

  it('does not guarantee a field under a parent that may be null', () => {
    const nested = (customer: JsonObject): JsonObject => ({
      type: 'object',
      required: ['customer'],
      properties: {
        customer: { ...customer, required: ['id'], properties: { id: { type: 'string' } } },
      },
    });

    // `{ customer: null }` is valid in each, so `customer.id` can be absent.
    expect([...guaranteedFieldPaths(nested({ type: ['object', 'null'] }))]).toEqual(['customer']);
    expect([...guaranteedFieldPaths(nested({ type: 'object', nullable: true }))]).toEqual([
      'customer',
    ]);
    expect([...guaranteedFieldPaths(nested({}))]).toEqual(['customer']);
    expect([...guaranteedFieldPaths(nested({ type: 'object' }))].sort()).toEqual([
      'customer',
      'customer.id',
    ]);
  });

  it('keeps a guarantee only when every union branch makes it', () => {
    const branch = (customerType: JsonValue): JsonObject => ({
      type: 'object',
      required: ['customer'],
      properties: {
        customer: { type: customerType, required: ['id'], properties: { id: { type: 'string' } } },
      },
    });

    // Both branches require customer.id, but the second admits `{ customer: null }`.
    expect([
      ...guaranteedFieldPaths({ anyOf: [branch('object'), branch(['object', 'null'])] }),
    ]).toEqual(['customer']);
    expect(
      [...guaranteedFieldPaths({ oneOf: [branch('object'), branch('object')] })].sort(),
    ).toEqual(['customer', 'customer.id']);
  });

  it('resolves an object through allOf', () => {
    const wrapped = (customer: JsonObject): JsonObject => ({
      type: 'object',
      required: ['customer'],
      properties: { customer },
    });

    const id: JsonObject = { required: ['id'], properties: { id: { type: 'string' } } };

    const customers: JsonObject[] = [
      { allOf: [{ type: 'object', ...id }] },
      { allOf: [{ type: 'object' }, id] },
      { type: 'object', allOf: [id] },
    ];

    for (const customer of customers)
      expect([...guaranteedFieldPaths(wrapped(customer))].sort()).toEqual([
        'customer',
        'customer.id',
      ]);

    // An allOf that never says object still admits null.
    expect([...guaranteedFieldPaths(wrapped({ allOf: [id] }))]).toEqual(['customer']);
  });

  it('follows references, and stops at a cycle', () => {
    const schema: JsonObject = {
      type: 'object',
      required: ['node'],
      properties: { node: { $ref: '#/$defs/node' } },
      $defs: {
        node: {
          type: 'object',
          required: ['id', 'next'],
          properties: { id: { type: 'string' }, next: { $ref: '#/$defs/node' } },
        },
      },
    };

    expect([...guaranteedFieldPaths(schema)].sort()).toEqual(['node', 'node.id', 'node.next']);
  });

  it('applies a requirement outside a union to the fields its branches declare', () => {
    const id = { type: 'object', properties: { id: { type: 'string' } } };

    expect([
      ...guaranteedFieldPaths({ type: 'object', required: ['id'], oneOf: [id, id] }),
    ]).toEqual(['id']);

    // And the other way: untyped branches that require what the object declares.
    expect([
      ...guaranteedFieldPaths({
        type: 'object',
        properties: { id: { type: 'string' } },
        oneOf: [{ required: ['id'] }, { required: ['id'] }],
      }),
    ]).toEqual(['id']);

    // Branches see what the object declares, so they reach below the key too.
    const customer = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };

    expect(
      [
        ...guaranteedFieldPaths({
          type: 'object',
          properties: { customer },
          oneOf: [{ required: ['customer'] }, { required: ['customer'] }],
        }),
      ].sort(),
    ).toEqual(['customer', 'customer.id']);
  });

  it('treats a nullable allOf part as admitting null', () => {
    const schema: JsonObject = {
      type: 'object',
      required: ['customer'],
      properties: {
        customer: {
          allOf: [{ type: 'object', nullable: true, required: ['id'], properties: { id: {} } }],
        },
      },
    };

    expect([...guaranteedFieldPaths(schema)]).toEqual(['customer']);
  });

  it('guarantees nothing in a payload that may itself be null', () => {
    const id = { required: ['id'], properties: { id: { type: 'string' } } };

    expect([...guaranteedFieldPaths({ type: ['object', 'null'], ...id })]).toEqual([]);
    expect([...guaranteedFieldPaths({ type: 'object', ...id })]).toEqual(['id']);
  });

  it('keeps every allOf part’s constraints on a property declared more than once', () => {
    const schema: JsonObject = {
      type: 'object',
      required: ['customer'],
      allOf: [
        {
          properties: {
            customer: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          },
        },
        { properties: { customer: { properties: { name: { type: 'string' } } } } },
      ],
    };

    expect([...guaranteedFieldPaths(schema)].sort()).toEqual(['customer', 'customer.id']);
  });
});
