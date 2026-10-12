import { describe, expect, it } from 'vitest';
import {
  assessEventChange,
  compatibilityBreaks,
  diffSchemas,
  summariseDrift,
  type JsonObject,
} from '../src/index';

// Properties stay plain JSON: JSON Schema allows boolean schemas, which the
// cases below use and SchemaNode's `properties` does not describe.
const wrap = (properties: JsonObject, required: string[] = []): JsonObject =>
  required.length ? { type: 'object', properties, required } : { type: 'object', properties };

const assess = (previous: JsonObject, proposed: JsonObject) =>
  assessEventChange({
    domain: 'payments',
    eventId: 'payment.completed',
    consumers: ['LedgerService'],
    previous,
    proposed,
  });

// Every case here was a real miss: the comparison walked a node's children and
// never the node itself, so a change with no properties on either side of it
// produced no findings at all.
describe('constraints on the node itself', () => {
  it('catches array element type changes', () => {
    const before = wrap({ skus: { type: 'array', items: { type: 'string' } } });
    const after = wrap({ skus: { type: 'array', items: { type: 'integer' } } });

    const diffs = diffSchemas(before, after);
    expect(diffs.map((d) => d.kind)).toContain('type_changed');
    expect(diffs.find((d) => d.kind === 'type_changed')?.path).toBe('skus[]');

    const findings = assess(before, after);
    expect(findings.some((f) => f.severity === 'breaking')).toBe(true);
    expect(findings.find((f) => f.severity === 'breaking')?.consumers).toEqual(['LedgerService']);
  });

  it('never calls a draft-04 boolean bound loosened, and never passes it as additive', () => {
    // exclusiveMaximum: true excludes the maximum itself; false → true tightens.
    const before = wrap({ amount: { type: 'number', maximum: 100, exclusiveMaximum: false } });
    const after = wrap({ amount: { type: 'number', maximum: 100, exclusiveMaximum: true } });

    const change = diffSchemas(before, after).find((d) => d.kind === 'constraint_changed');
    expect(change?.constraint).toMatchObject({ keyword: 'exclusiveMaximum', direction: 'changed' });
    expect(assess(before, after).map((f) => f.severity)).not.toContain('additive');
  });

  it('catches a tightened numeric bound', () => {
    const findings = assess(
      wrap({ amountMinor: { type: 'integer', minimum: 0 } }),
      wrap({ amountMinor: { type: 'integer', minimum: 100 } }),
    );

    const finding = findings.find((f) => f.kind === 'constraint_tightened');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.message).toContain('minimum');
  });

  it('reads a loosened bound as additive', () => {
    const findings = assess(
      wrap({ note: { type: 'string', maxLength: 10 } }),
      wrap({ note: { type: 'string', maxLength: 100 } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_loosened')?.severity).toBe('additive');
  });

  it('treats a newly added bound as a restriction', () => {
    const findings = assess(
      wrap({ items: { type: 'array' } }),
      wrap({ items: { type: 'array', maxItems: 5 } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_tightened')?.severity).toBe('breaking');
  });

  it('treats a changed pattern as breaking, because it cannot be shown to be safe', () => {
    const findings = assess(
      wrap({ ref: { type: 'string', pattern: '^a' } }),
      wrap({ ref: { type: 'string', pattern: '^b' } }),
    );

    // The default gate is the one that promises to catch breaks. A rewritten
    // regex may reject payloads that were accepted, and no cheap analysis says
    // whether it does, so it must not pass by default.
    expect(findings.find((f) => f.kind === 'constraint_changed')?.severity).toBe('breaking');
  });

  it('compares the payload root itself', () => {
    const findings = assess(
      { type: 'object', properties: {}, minProperties: 0 },
      { type: 'array', items: { type: 'string' } },
    );

    expect(findings.some((f) => f.kind === 'type_changed' && f.severity === 'breaking')).toBe(true);
  });
});

describe('traversal reaches every node, not just the ones with properties', () => {
  it('catches a nested array element type change', () => {
    // string[][] → integer[][]: two levels of `items` and no properties anywhere.
    const findings = assess(
      wrap({ grid: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }),
      wrap({ grid: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } }),
    );

    const finding = findings.find((f) => f.kind === 'type_changed');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.diff?.path).toBe('grid[][]');
  });

  it('catches an unconstrained array gaining an element type', () => {
    const findings = assess(
      wrap({ tags: { type: 'array' } }),
      wrap({ tags: { type: 'array', items: { type: 'string' } } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_tightened')?.severity).toBe('breaking');
  });

  it('catches an array losing its element type', () => {
    const findings = assess(
      wrap({ tags: { type: 'array', items: { type: 'string' } } }),
      wrap({ tags: { type: 'array' } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_loosened')?.severity).toBe('additive');
  });

  it('catches additionalProperties being closed', () => {
    const findings = assess(
      { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true },
      { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    );

    const finding = findings.find((f) => f.kind === 'constraint_tightened');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.message).toContain('additionalProperties');
  });
});

describe('the compatibility gate sees what the severity gate sees', () => {
  it('fails BACKWARD and FULL on a tightened bound', () => {
    const report = summariseDrift(
      assess(
        wrap({ amountMinor: { type: 'integer', minimum: 0 } }),
        wrap({ amountMinor: { type: 'integer', minimum: 100 } }),
      ),
    );

    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    expect(compatibilityBreaks(report, 'full').length).toBeGreaterThan(0);
    expect(compatibilityBreaks(report, 'none')).toHaveLength(0);
  });
});

describe('enum compatibility is decided from values, not from prose', () => {
  it('reads restricting an open string as breaking', () => {
    const findings = assess(
      wrap({ status: { type: 'string' } }),
      wrap({ status: { type: 'string', enum: ['paid'] } }),
    );

    const finding = findings.find((f) => f.kind === 'enum_narrowed');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.message).toContain('restricted');
  });

  // The classifier used to search the rendered detail for "-", so an added
  // value that merely contained a hyphen was reported as a narrowing.
  it('reads an added hyphenated value as widening', () => {
    const findings = assess(
      wrap({ status: { type: 'string', enum: ['paid', 'failed'] } }),
      wrap({ status: { type: 'string', enum: ['paid', 'failed', 'on-hold'] } }),
    );

    const finding = findings.find((f) => f.kind === 'enum_widened');
    expect(finding?.severity).toBe('additive');
    expect(finding?.consumers).toEqual([]);
  });

  it('fails both strategies when an enum swaps a value', () => {
    const report = summariseDrift(
      assess(
        wrap({ status: { type: 'string', enum: ['a', 'b'] } }),
        wrap({ status: { type: 'string', enum: ['b', 'c'] } }),
      ),
    );

    // Removing "a" breaks a new reader on old data; adding "c" breaks an old
    // reader on new data. One kind cannot say both, so the values decide.
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    expect(compatibilityBreaks(report, 'forward').length).toBeGreaterThan(0);
  });

  it('still reads a removed value as narrowing', () => {
    const findings = assess(
      wrap({ status: { type: 'string', enum: ['paid', 'failed'] } }),
      wrap({ status: { type: 'string', enum: ['paid'] } }),
    );

    expect(findings.find((f) => f.kind === 'enum_narrowed')?.severity).toBe('breaking');
  });

  it('reads dropping an enum entirely as additive', () => {
    const findings = assess(
      wrap({ status: { type: 'string', enum: ['paid'] } }),
      wrap({ status: { type: 'string' } }),
    );

    expect(findings.find((f) => f.kind === 'enum_widened')?.severity).toBe('additive');
  });
});

describe('structures a property walk never reaches', () => {
  it('sees a constraint tightened inside $defs, through a $ref', () => {
    const defs = (minimum: number) => ({
      $defs: { Money: { type: 'integer', minimum } },
      type: 'object',
      properties: { amount: { $ref: '#/$defs/Money' } },
    });

    const findings = assess(defs(0), defs(100));
    const finding = findings.find((f) => f.kind === 'constraint_tightened');
    expect(finding?.severity).toBe('breaking');
    expect(compatibilityBreaks(summariseDrift(findings), 'backward').length).toBeGreaterThan(0);
  });

  it('sees an anyOf branch change type', () => {
    const union = (second: string) =>
      wrap({ value: { anyOf: [{ type: 'string' }, { type: second }] } });

    const findings = assess(union('number'), union('boolean'));
    const finding = findings.find((f) => f.kind === 'type_changed');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.diff?.path).toBe('value|anyOf[1]');
    expect(compatibilityBreaks(summariseDrift(findings), 'backward').length).toBeGreaterThan(0);
  });

  it('reports branches being added or removed from a union', () => {
    const findings = assess(
      wrap({ value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }),
      wrap({ value: { anyOf: [{ type: 'string' }] } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_tightened')?.severity).toBe('breaking');
  });

  it('treats an extra allOf clause as a tightening, not a loosening', () => {
    const findings = assess(
      wrap({ value: { allOf: [{ type: 'string' }] } }),
      wrap({ value: { allOf: [{ type: 'string' }, { minLength: 5 }] } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_tightened')?.severity).toBe('breaking');
  });

  it('survives a recursive $ref instead of hanging on it', () => {
    const recursive = (minimum: number) => ({
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
      type: 'object',
      properties: { root: { $ref: '#/$defs/Node' }, depth: { type: 'integer', minimum } },
    });

    const findings = assess(recursive(0), recursive(1));
    expect(findings.some((f) => f.kind === 'constraint_tightened')).toBe(true);
  });
});

describe('a field is only optional if the object tolerates unknowns', () => {
  it('fails FORWARD when an optional field joins a closed object', () => {
    const report = summariseDrift(
      assess(
        { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
        {
          type: 'object',
          properties: { id: { type: 'string' }, note: { type: 'string' } },
          additionalProperties: false,
        },
      ),
    );

    // The old schema rejects every new payload carrying `note`.
    expect(compatibilityBreaks(report, 'forward').length).toBeGreaterThan(0);
  });

  it('passes FORWARD when the object accepts unknown properties', () => {
    const report = summariseDrift(
      assess(
        wrap({ id: { type: 'string' } }),
        wrap({ id: { type: 'string' }, note: { type: 'string' } }),
      ),
    );

    expect(compatibilityBreaks(report, 'forward')).toHaveLength(0);
  });

  it('fails BACKWARD when a field is dropped from an object that is now closed', () => {
    const report = summariseDrift(
      assess(
        { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } } },
        { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
      ),
    );

    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });
});

describe('introducing an enum restricts, it does not add', () => {
  it('fails BACKWARD but passes FORWARD', () => {
    const report = summariseDrift(
      assess(
        wrap({ status: { type: 'string' } }),
        wrap({ status: { type: 'string', enum: ['paid'] } }),
      ),
    );

    // Old data may hold any string, so a new reader rejects it.
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    // Every newly permitted value was already accepted by an open string.
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(0);
  });
});

describe('composition direction is not a branch count', () => {
  it('reads introducing anyOf over an open field as a restriction', () => {
    // Before: anything. After: strings only. More branches, less accepted.
    const report = summariseDrift(
      assess(wrap({ value: {} }), wrap({ value: { anyOf: [{ type: 'string' }] } })),
    );

    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });

  it('refuses to guess a direction for oneOf', () => {
    // oneOf demands exactly one match, so an added branch can reject a value
    // that now satisfies two — an integer against number and integer.
    const findings = assess(
      wrap({ value: { oneOf: [{ type: 'number' }] } }),
      wrap({ value: { oneOf: [{ type: 'number' }, { type: 'integer' }] } }),
    );

    const finding = findings.find((f) => f.kind === 'constraint_changed');
    // Ambiguous means "cannot be proven safe", which the default gate must
    // stop, not wave through.
    expect(finding?.severity).toBe('breaking');
    const report = summariseDrift(findings);
    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    expect(compatibilityBreaks(report, 'forward').length).toBeGreaterThan(0);
  });

  it('still reads an added anyOf branch as widening', () => {
    const findings = assess(
      wrap({ value: { anyOf: [{ type: 'string' }] } }),
      wrap({ value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }),
    );

    expect(findings.find((f) => f.kind === 'constraint_loosened')?.severity).toBe('additive');
  });
});

describe('$ref siblings are part of the schema', () => {
  it('sees a sibling constraint tighten beside a $ref', () => {
    const withMinimum = (minimum: number) => ({
      $defs: { Amount: { type: 'integer' } },
      type: 'object',
      properties: { amount: { $ref: '#/$defs/Amount', minimum } },
    });

    const report = summariseDrift(assess(withMinimum(0), withMinimum(100)));
    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });
});

describe('a boolean is a schema, not a missing one', () => {
  it('catches items: false closing an open array', () => {
    // `items: false` rejects every non-empty array.
    const report = summariseDrift(
      assess(wrap({ tags: { type: 'array' } }), wrap({ tags: { type: 'array', items: false } })),
    );

    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });

  it('catches items going from true to false', () => {
    const findings = assess(
      wrap({ tags: { type: 'array', items: true } }),
      wrap({ tags: { type: 'array', items: false } }),
    );

    const finding = findings.find((f) => f.kind === 'type_narrowed');
    expect(finding?.severity).toBe('breaking');
    expect(finding?.message).toContain('never');
  });
});

describe('a $ref and its siblings both apply', () => {
  it('sees the referenced constraint tighten even when a sibling names it too', () => {
    // Both constraints apply; the sibling does not override the target, so a
    // change to the target must not be hidden behind an unchanged sibling.
    const schema = (targetMinimum: number) => ({
      $defs: { Amount: { type: 'integer', minimum: targetMinimum } },
      type: 'object',
      properties: { amount: { $ref: '#/$defs/Amount', minimum: 0 } },
    });

    const report = summariseDrift(assess(schema(0), schema(100)));
    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });
});

describe('a boolean property schema is a schema', () => {
  it('catches a property being forbidden outright', () => {
    // `blocked: false` rejects every payload that carries the field.
    const findings = assess(wrap({ id: { type: 'string' } }), {
      type: 'object',
      properties: { id: { type: 'string' }, blocked: false },
    });

    const finding = findings.find((f) => f.kind === 'field_added');
    expect(finding?.severity).toBe('breaking');
    expect(compatibilityBreaks(summariseDrift(findings), 'backward').length).toBeGreaterThan(0);
  });

  it('catches a property narrowing from any to never', () => {
    const findings = assess(
      { type: 'object', properties: { extra: true } },
      { type: 'object', properties: { extra: false } },
    );

    expect(findings.find((f) => f.kind === 'type_narrowed')?.severity).toBe('breaking');
  });
});

describe('required stands on its own', () => {
  it('catches a requirement added with no property definition', () => {
    // {} was valid; it is not any more.
    const report = summariseDrift(assess({ type: 'object' }, { type: 'object', required: ['id'] }));
    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
  });

  it('does not repeat a removed property as no longer required', () => {
    const findings = assess(
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      { type: 'object', properties: {} },
    );

    expect(findings.filter((f) => f.kind === 'field_removed')).toHaveLength(1);
    expect(findings.some((f) => f.kind === 'required_removed')).toBe(false);
  });
});

describe('an external $ref cannot be followed, so a new target is a change', () => {
  it('reports a retargeted external $ref and fails both strategies', () => {
    const report = summariseDrift(
      assess(wrap({ a: { $ref: 'other.json#/A' } }), wrap({ a: { $ref: 'other.json#/B' } })),
    );

    expect(report.findings.map((f) => f.diff?.detail)).toContain(
      '$ref other.json#/A → other.json#/B',
    );

    expect(report.hasBreaking).toBe(true);
    expect(compatibilityBreaks(report, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(1);
  });
});

describe('a type is a set, and it can grow or shrink', () => {
  const gates = (before: JsonObject, after: JsonObject) => {
    const report = summariseDrift(assess(wrap({ v: before }), wrap({ v: after })));

    return {
      kinds: report.findings.map((f) => f.kind),
      backward: compatibilityBreaks(report, 'backward').length,
      forward: compatibilityBreaks(report, 'forward').length,
    };
  };

  it('ignores a reordered type list', () => {
    expect(gates({ type: ['string', 'null'] }, { type: ['null', 'string'] }).kinds).toEqual([]);
  });

  it('reads adding null, or integer → number, as widening: FORWARD only', () => {
    expect(gates({ type: 'string' }, { type: ['string', 'null'] })).toEqual({
      kinds: ['type_widened'],
      backward: 0,
      forward: 1,
    });

    expect(gates({ type: 'integer' }, { type: 'number' })).toEqual({
      kinds: ['type_widened'],
      backward: 0,
      forward: 1,
    });
  });

  it('reads dropping null as narrowing: BACKWARD only', () => {
    expect(gates({ type: ['string', 'null'] }, { type: 'string' })).toEqual({
      kinds: ['type_narrowed'],
      backward: 1,
      forward: 0,
    });
  });

  it('still fails both strategies on an unrelated type', () => {
    expect(gates({ type: 'string' }, { type: 'boolean' })).toEqual({
      kinds: ['type_changed'],
      backward: 1,
      forward: 1,
    });
  });

  it('still walks the fields of an object that became nullable', () => {
    const before = { type: 'object', properties: { id: { type: 'string' } } };
    const after = { type: ['object', 'null'], properties: { id: { type: 'integer' } } };
    expect(gates(before, after).kinds).toEqual(['type_widened', 'type_changed']);
  });
});

describe('property-count bounds and formats have a direction', () => {
  it('reads a raised minProperties as tightening and a raised maxProperties as loosening', () => {
    const kinds = assess(
      wrap({ m: { type: 'object', minProperties: 1, maxProperties: 2 } }),
      wrap({ m: { type: 'object', minProperties: 2, maxProperties: 3 } }),
    ).map((f) => f.kind);

    expect([...kinds].sort()).toEqual(['constraint_loosened', 'constraint_tightened']);
  });

  it('gates an added format under BACKWARD and a dropped one under FORWARD', () => {
    const added = summariseDrift(
      assess(wrap({ at: { type: 'string' } }), wrap({ at: { type: 'string', format: 'date' } })),
    );

    expect(compatibilityBreaks(added, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(added, 'forward')).toHaveLength(0);

    const dropped = summariseDrift(
      assess(wrap({ at: { type: 'string', format: 'date' } }), wrap({ at: { type: 'string' } })),
    );

    expect(compatibilityBreaks(dropped, 'backward')).toHaveLength(0);
    expect(compatibilityBreaks(dropped, 'forward')).toHaveLength(1);
  });
});

describe('consumer field usage', () => {
  const usage = (previous: JsonObject, proposed: JsonObject, fields: string[]) =>
    assessEventChange({
      domain: 'orders',
      eventId: 'order.placed',
      consumers: ['Billing'],
      consumerFields: { Billing: fields },
      previous,
      proposed,
    }).find((f) => f.severity === 'breaking')?.usage;

  const order = (sku: JsonObject): JsonObject =>
    wrap({
      customer: wrap({ email: { type: 'string' } }),
      items: { type: 'array', items: wrap({ sku }) },
    });

  it('matches array items and nesting in either direction', () => {
    const before = order({ type: 'string' });
    const after = order({ type: 'integer' });

    expect(usage(before, after, ['items[].sku'])?.reads).toEqual(['Billing']);
    expect(usage(before, after, ['items'])?.reads).toEqual(['Billing']);
    expect(usage(before, after, ['customer.email'])?.unaffected).toEqual(['Billing']);
  });

  it('charges a validation keyword below a field to that field', () => {
    const before = order({ type: 'string' });
    const after = order({ type: 'string', not: { const: 'x' } });

    expect(usage(before, after, ['items[].sku'])?.reads).toEqual(['Billing']);
    expect(usage(before, after, ['customer'])?.unaffected).toEqual(['Billing']);
  });

  it('treats a change to the payload root as reaching every consumer', () => {
    const before = order({ type: 'string' });

    expect(
      usage(before, { ...before, additionalProperties: false }, ['customer.email'])?.reads,
    ).toEqual(['Billing']);
  });
});
