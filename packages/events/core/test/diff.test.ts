import { describe, expect, it } from 'vitest';
import { diffSchemas } from '../src/diff';

const baseSchema = {
  type: 'object',
  required: ['id', 'amount'],
  properties: {
    id: { type: 'string' },
    amount: { type: 'integer' },
    note: { type: 'string', description: 'free-form' },
    legacyId: { type: 'string' },
  },
};

describe('diffSchemas', () => {
  it('returns no changes for identical schemas', () => {
    expect(diffSchemas(baseSchema, baseSchema)).toEqual([]);
  });

  it('detects added properties', () => {
    const next = {
      ...baseSchema,
      properties: { ...baseSchema.properties, currency: { type: 'string' } },
    };

    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({
      kind: 'added',
      path: 'currency',
      detail: 'string',
      isRequired: false,
      // The object accepts unknown properties, so `currency` could already
      // carry any value; typing it now rejects some of them. Recorded here and
      // acted on by the BACKWARD gate, not by severity.
      constrainsPreviouslyFree: true,
    });
  });

  it('detects removed properties', () => {
    const next = {
      ...baseSchema,
      properties: Object.fromEntries(
        Object.entries(baseSchema.properties).filter(([k]) => k !== 'legacyId'),
      ),
    };

    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({
      kind: 'removed',
      path: 'legacyId',
      detail: 'string',
      wasRequired: false,
    });
  });

  it('detects type changes', () => {
    const next = {
      ...baseSchema,
      properties: { ...baseSchema.properties, amount: { type: 'number' } },
    };

    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({
      kind: 'type_changed',
      path: 'amount',
      detail: 'integer → number',
      typeDirection: 'widened',
    });
  });

  it('detects required becoming required', () => {
    const next = { ...baseSchema, required: ['id', 'amount', 'note'] };
    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({ kind: 'required_added', path: 'note', detail: 'now required' });
  });

  it('detects required becoming optional', () => {
    const next = { ...baseSchema, required: ['id'] };
    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({
      kind: 'required_removed',
      path: 'amount',
      detail: 'now optional',
    });
  });

  it('detects description changes', () => {
    const next = {
      ...baseSchema,
      properties: {
        ...baseSchema.properties,
        note: { type: 'string', description: 'updated text' },
      },
    };

    const diffs = diffSchemas(baseSchema, next);
    expect(diffs).toContainEqual({
      kind: 'description_changed',
      path: 'note',
      detail: 'free-form → updated text',
    });
  });

  it('detects format change on string', () => {
    const next = {
      type: 'object',
      properties: { when: { type: 'string', format: 'date-time' } },
    };

    const prev = {
      type: 'object',
      properties: { when: { type: 'string', format: 'date' } },
    };

    const diffs = diffSchemas(prev, next);
    expect(diffs).toContainEqual({
      kind: 'format_changed',
      path: 'when',
      detail: 'date → date-time',
      constraint: {
        keyword: 'format',
        previous: 'date',
        current: 'date-time',
        direction: 'changed',
      },
    });
  });

  it('detects enum changes', () => {
    const prev = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok', 'fail'] } },
    };

    const next = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok', 'fail', 'pending'] } },
    };

    const diffs = diffSchemas(prev, next);
    const enumDiff = diffs.find((d) => d.kind === 'enum_changed');
    expect(enumDiff).toBeDefined();
    expect(enumDiff?.detail).toContain('pending');
  });

  describe('nested schemas', () => {
    const nested = {
      type: 'object',
      required: ['payment'],
      properties: {
        payment: {
          type: 'object',
          required: ['amount'],
          properties: { amount: { type: 'number' }, note: { type: 'string' } },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sku'],
            properties: { sku: { type: 'string' } },
          },
        },
      },
    };

    it('reports a type change on a nested field with its dotted path', () => {
      const next = structuredClone(nested);
      next.properties.payment.properties.amount.type = 'string';
      const diff = diffSchemas(nested, next).find((d) => d.kind === 'type_changed');
      expect(diff?.path).toBe('payment.amount');
      expect(diff?.detail).toBe('number → string');
    });

    it('reports a removed nested field, and whether it was required', () => {
      const next = structuredClone(nested);
      Reflect.deleteProperty(next.properties.payment.properties, 'amount');
      const diff = diffSchemas(nested, next).find((d) => d.kind === 'removed');
      expect(diff?.path).toBe('payment.amount');
      expect(diff?.wasRequired).toBe(true);
    });

    it('walks into array items', () => {
      const next = structuredClone(nested);
      Object.assign(next.properties.items.items.properties, { price: { type: 'number' } });
      const diff = diffSchemas(nested, next).find((d) => d.kind === 'added');
      expect(diff?.path).toBe('items[].price');
    });

    it('reports a removed object once, not once per field underneath it', () => {
      const next = structuredClone(nested);
      Reflect.deleteProperty(next.properties, 'payment');
      next.required = [];
      const removed = diffSchemas(nested, next).filter((d) => d.kind === 'removed');
      expect(removed.map((d) => d.path)).toEqual(['payment']);
      expect(removed[0]!.wasRequired).toBe(true);
    });

    it('does not descend into a field whose type changed', () => {
      const next = structuredClone(nested);
      Object.assign(next.properties, { payment: { type: 'string' } });
      const diffs = diffSchemas(nested, next);
      expect(diffs.filter((d) => d.kind === 'type_changed').map((d) => d.path)).toEqual([
        'payment',
      ]);
      expect(diffs.some((d) => d.path.startsWith('payment.'))).toBe(false);
    });

    it('reports a nested required transition at its own path', () => {
      const next = structuredClone(nested);
      next.properties.payment.required = ['amount', 'note'];
      const diff = diffSchemas(nested, next).find((d) => d.kind === 'required_added');
      expect(diff?.path).toBe('payment.note');
    });

    it('terminates on a deeply nested schema', () => {
      const deep = (depth: number): any =>
        depth === 0
          ? { type: 'string' }
          : { type: 'object', properties: { next: deep(depth - 1) } };

      expect(() => diffSchemas(deep(200), deep(200))).not.toThrow();
    });
  });

  it('sorts results by kind for stable rendering', () => {
    const next = {
      type: 'object',
      required: ['id', 'fresh'],
      properties: {
        id: { type: 'string' },
        fresh: { type: 'string' },
        amount: { type: 'number' },
      },
    };

    const diffs = diffSchemas(baseSchema, next);
    const kinds = diffs.map((d) => d.kind);
    // Removed first, then added, then changes — that's the stable order
    expect(kinds[0]).toBe('removed');
    expect(kinds.indexOf('added')).toBeLessThan(kinds.indexOf('type_changed'));
  });
});
