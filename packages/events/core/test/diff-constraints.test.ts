import { describe, expect, it } from 'vitest';
import { assessEventChange, compatibilityBreaks, diffSchemas, summariseDrift } from '../src/index';
import type { CompatibilityMode, JsonObject, JsonValue } from '../src/index';

// Properties stay plain JSON: JSON Schema allows boolean schemas, which the
// cases below use and SchemaNode's `properties` does not describe.
const wrap = (properties: JsonObject, required: Array<string> = []): JsonObject =>
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

const branching = (branches: number) => ({
  $defs: {
    Base: {
      type: 'object',
      allOf: Array.from({ length: branches }, (_, i) => ({ required: [`r${i}`] })),
    },
  },
  type: 'object',
  properties: { value: { $ref: '#/$defs/Base', required: ['id'] } },
});

const beside = (sibling: { required?: Array<string> }) => ({
  $defs: { Base: { type: 'object', allOf: [{ required: ['name'] }] } },
  type: 'object',
  properties: { value: { $ref: '#/$defs/Base', ...sibling } },
});

const capped = (sibling: { maxLength?: number }) => ({
  $defs: { Name: { type: 'string', maxLength: 5 } },
  type: 'object',
  properties: { value: { $ref: '#/$defs/Name', ...sibling } },
});

const TUPLE: JsonObject = { unevaluatedItems: { type: 'string' } };

const TAGS: JsonObject = { type: 'array', items: { type: 'string' } };

const referring = (sibling: JsonObject, target = TAGS): JsonObject => ({
  $defs: { Target: target },
  type: 'object',
  properties: { value: { $ref: '#/$defs/Target', ...sibling } },
});

const enclosed = (sibling: JsonObject, target: JsonObject = {}): JsonObject => ({
  $defs: { Base: { type: 'object', ...target } },
  type: 'object',
  properties: {
    value: { allOf: [{ $ref: '#/$defs/Base', ...sibling }], unevaluatedProperties: false },
  },
});

/** A schema nested far deeper than the call stack goes. */
const nested = (keyword: 'allOf' | 'items'): JsonObject => {
  let schema: JsonObject = { type: 'string' };

  for (let depth = 0; depth < 20_000; depth += 1) {
    schema = { [keyword]: keyword === 'allOf' ? [schema] : schema };
  }

  return schema;
};

const elsewhere = (value: JsonObject): JsonObject => ({
  type: 'object',
  properties: {
    value: { type: 'string', ...value },
    metadata: { type: 'object', unevaluatedProperties: false },
  },
});

const severities = (from: JsonObject, to: JsonObject) => [
  ...new Set(assess(from, to).map(({ severity }) => severity)),
];

const deepValue = (last: string): JsonValue => {
  let value: JsonValue = last;

  for (let depth = 0; depth < 20_000; depth += 1) {
    value = [value];
  }

  return value;
};

const closing = (schema: JsonObject): JsonObject =>
  wrap({ value: { ...schema, unevaluatedProperties: false } });

const besideA = (branch: JsonObject): JsonObject =>
  closing({ allOf: [branch, { properties: { a: true } }] });

const fielded = (sibling: JsonObject, target: JsonObject): JsonObject => ({
  $defs: {
    Short: { type: 'string' },
    Target: {
      type: 'object',
      properties: { id: { type: 'string' }, ref: { $ref: '#/$defs/Short' } },
      ...target,
    },
  },
  type: 'object',
  properties: { value: { $ref: '#/$defs/Target', properties: sibling } },
});

const modesBroken = (from: JsonObject, to: JsonObject) => {
  const report = summariseDrift(assess(from, to));

  return (['backward', 'forward'] as const).filter(
    (mode) => compatibilityBreaks(report, mode).length > 0,
  );
};

describe('a $ref with siblings lines up with the same schema', () => {
  it('reports only the branch a target gains, beside an unchanged sibling', () => {
    const findings = assess(branching(1), branching(2));

    expect(findings.map((f) => f.diff?.path)).toEqual(['value|allOf']);
  });

  it.each([
    ['removed', {}],
    ['changed', { required: ['other'] }],
  ])('compares the target with itself when a sibling is %s', (_, sibling) => {
    const id = beside({ required: ['id'] });
    const other = beside(sibling);
    const named = expect.stringContaining('.name');

    expect(assess(id, other).map((f) => f.diff?.path)).not.toContainEqual(named);
    expect(assess(other, id).map((f) => f.diff?.path)).not.toContainEqual(named);
    expect(assess(id, beside({})).filter((f) => f.severity === 'breaking')).toEqual([]);
  });

  it('reads a sibling by what it adds to the same keyword in the target', () => {
    expect(assess(capped({}), capped({ maxLength: 10 }))).toEqual([]);
    expect(assess(capped({ maxLength: 10 }), capped({}))).toEqual([]);
    expect(assess(capped({}), capped({ maxLength: 3 })).map((f) => f.diff?.detail)).toEqual([
      'maxLength 5 → 3',
    ]);
  });

  it.each([
    ['required', ['id'], ['id']],
    ['type', 'integer', 'number'],
    ['enum', ['a', 'b'], ['b', 'a', 'c']],
    ['multipleOf', 10, 5],
    ['uniqueItems', true, false],
    ['pattern', '^a', '^a'],
  ])('finds nothing in a %s the target already says', (keyword, target, sibling) => {
    const schema = (next: JsonObject) => ({
      $defs: { Base: { [keyword]: target } },
      type: 'object',
      properties: { value: { $ref: '#/$defs/Base', ...next } },
    });

    expect(assess(schema({}), schema({ [keyword]: sibling }))).toEqual([]);
  });

  it.each<JsonObject>([
    { uniqueItems: false },
    { minItems: 0 },
    { items: {} },
    { required: [] },
    { additionalProperties: true },
    { not: false },
  ])('finds nothing in a sibling that rejects nothing: %j', (sibling) => {
    expect(assess(referring({}), referring(sibling))).toEqual([]);
    expect(assess(referring(sibling), referring({}))).toEqual([]);
  });

  it('keeps a sibling field that an unevaluatedProperties around it relies on', () => {
    expect(assess(enclosed({ properties: { a: true } }), enclosed({}))).not.toEqual([]);
    expect(assess(enclosed({ additionalProperties: true }), enclosed({}))).not.toEqual([]);
    expect(
      assess(enclosed({ allOf: [{ properties: { b: true } }] }), enclosed({})).map(
        (f) => f.severity,
      ),
    ).not.toContain('additive');
  });

  it('reads unevaluatedProperties only where it applies', () => {
    expect(severities(elsewhere({ allOf: [{ minLength: 2 }] }), elsewhere({}))).toEqual([
      'additive',
    ]);
    expect(severities(enclosed({}), enclosed({ properties: { a: true } }))).toEqual(['additive']);
    expect(severities(enclosed({ properties: { a: true } }), enclosed({}))).not.toContain(
      'additive',
    );
  });

  it('keeps an object both enums allow, however its fields are ordered', () => {
    const target: JsonObject = { enum: [{ a: 1, b: 2 }, { c: 3 }] };
    const both = referring({ enum: [{ b: 2, a: 1 }, { c: 3 }] }, target);

    expect(assess(both, referring({ enum: [{ c: 3 }] }, target))).not.toEqual([]);
    expect(assess(both, referring({}, target))).toEqual([]);
  });

  it('compares a schema deeper than the walk with itself', () => {
    expect(diffSchemas(nested('allOf'), nested('allOf'))).toEqual([]);
    expect(diffSchemas(nested('items'), nested('items'))).toEqual([]);
    expect(diffSchemas(referring({}, nested('items')), referring({}, nested('items')))).toEqual([]);
  });

  it('leaves a target’s own unevaluatedProperties out of what is beside the reference', () => {
    const closed: JsonObject = { type: 'object', unevaluatedProperties: false };
    const named = referring({ properties: { a: true } }, closed);

    expect(assess(named, referring({}, closed))).toEqual([]);
    expect(assess(referring({}, closed), named)).toEqual([]);
    // A target's unevaluatedItems says nothing of one for properties beside the reference.
    expect(
      severities(
        referring({ properties: { a: {} }, unevaluatedProperties: false }, TUPLE),
        referring({ unevaluatedProperties: false }, TUPLE),
      ),
    ).toEqual(['breaking']);
    // One around the reference reads both, and the target's names every field.
    expect(
      severities(
        enclosed({ properties: { a: true } }, { unevaluatedProperties: { type: 'string' } }),
        enclosed({}, { unevaluatedProperties: { type: 'string' } }),
      ),
    ).toEqual([]);
  });

  it.each<[string, { before: JsonObject; after: JsonObject; expected: Array<string> }]>([
    [
      'names nothing',
      {
        before: { dependentSchemas: { a: { required: ['b'] } } },
        after: {},
        expected: ['additive'],
      },
    ],
    [
      'names only what the target still names',
      {
        before: {
          allOf: [{ properties: { a: true, b: true } }, { properties: { a: { maximum: 5 } } }],
        },
        after: { allOf: [{ properties: { a: true, b: true } }] },
        expected: ['additive'],
      },
    ],
    [
      'names fields a pattern still names',
      {
        before: { patternProperties: { '^a': true }, allOf: [{ properties: { ab: true } }] },
        after: { patternProperties: { '^a': true } },
        expected: [],
      },
    ],
    [
      'names fields of a value that is never an object',
      {
        before: { type: 'string', allOf: [{ properties: { a: true } }] },
        after: { type: 'string' },
        expected: [],
      },
    ],
    [
      'names a field nothing else does',
      { before: { allOf: [{ properties: { a: true } }] }, after: {}, expected: ['breaking'] },
    ],
    [
      'names every field',
      {
        before: { properties: { a: true }, allOf: [{ additionalProperties: { type: 'string' } }] },
        after: { properties: { a: true } },
        expected: ['breaking'],
      },
    ],
    [
      'named fields only to reject them',
      {
        before: { allOf: [{ patternProperties: { '^a': false }, additionalProperties: false }] },
        after: {},
        expected: [],
      },
    ],
    [
      'may name a field',
      { before: { anyOf: [{ properties: { a: true } }, {}] }, after: {}, expected: ['breaking'] },
    ],
  ])('reads what goes under unevaluatedProperties when it %s', (_, { before, after, expected }) => {
    expect(severities(closing(before), closing(after))).toEqual(expected);
  });

  it('reads what another branch under the same unevaluatedProperties names', () => {
    const named = { allOf: [{ properties: { a: { maximum: 5 } } }] };
    const alone = { allOf: [{ properties: { b: true } }] };

    expect(severities(besideA(named), besideA({}))).toEqual(['additive']);
    expect(severities(besideA(alone), besideA({}))).toEqual(['breaking']);
  });

  it('prints a value nested deeper than the call stack', () => {
    for (const keyword of ['const', 'enum', 'x-unmodelled', 'dependentRequired']) {
      const schema = (last: string) =>
        wrap({ value: { [keyword]: keyword === 'enum' ? [deepValue(last)] : deepValue(last) } });

      const findings = assess(schema('a'), schema('b'));

      expect(findings.length > 0).toBe(!keyword.startsWith('x-'));
    }

    expect(
      assess(wrap({ value: { const: { a: [1] } } }), wrap({ value: { const: 2 } })).map(
        (f) => f.diff?.detail,
      ),
    ).toEqual(['const {"a":[1]} → 2']);
  });

  it.each<[string, { before: JsonObject; after: JsonObject; expected: Array<string> }]>([
    [
      'dropped, so items governs its place',
      {
        before: { prefixItems: [{}], items: { type: 'string', minLength: 2 } },
        after: { items: { type: 'string', minLength: 2 } },
        expected: ['breaking'],
      },
    ],
    [
      'dropped with nothing after it',
      { before: { prefixItems: [{ type: 'string' }] }, after: {}, expected: ['additive'] },
    ],
    ['added', { before: {}, after: { prefixItems: [{ type: 'string' }] }, expected: ['breaking'] }],
    ['that rejects nothing', { before: {}, after: { prefixItems: [{}, true] }, expected: [] }],
    [
      'longer by one',
      {
        before: { prefixItems: [{ type: 'string' }] },
        after: { prefixItems: [{ type: 'string' }, { type: 'integer' }] },
        expected: ['breaking'],
      },
    ],
    [
      'longer, where items allowed nothing',
      {
        before: { prefixItems: [{}], items: false },
        after: { prefixItems: [{}, { type: 'string' }], items: false },
        expected: ['additive'],
      },
    ],
  ])('reads a prefixItems %s', (_, { before, after, expected }) => {
    expect(
      severities(
        wrap({ list: { type: 'array', ...before } }),
        wrap({ list: { type: 'array', ...after } }),
      ),
    ).toEqual(expected);
  });

  it.each<
    [string, { from: JsonObject; to: JsonObject; target?: JsonObject; expected: Array<string> }]
  >([
    [
      'added',
      { from: {}, to: { note: { type: 'string' } }, expected: ['additive field_added value.note'] },
    ],
    [
      'removed',
      {
        from: { note: { type: 'string' } },
        to: {},
        expected: ['breaking field_removed value.note'],
      },
    ],
    [
      'added as anything',
      { from: {}, to: { note: true }, expected: ['additive field_added value.note'] },
    ],
    [
      'tightened',
      {
        from: {},
        to: { id: { maxLength: 3 } },
        expected: ['breaking constraint_tightened value.id'],
      },
    ],
    [
      'tightened through its own reference',
      {
        from: {},
        to: { ref: { maxLength: 3 } },
        expected: ['breaking constraint_tightened value.ref'],
      },
    ],
    [
      'added beside a closed target',
      {
        from: {},
        to: { note: { type: 'string' } },
        target: { additionalProperties: false },
        expected: ['breaking constraint_tightened value|allOf'],
      },
    ],
  ])(
    'reads a field %s beside a $ref as one written inline',
    (_, { from, to, target, expected }) => {
      const schema = (properties: JsonObject) => fielded(properties, target ?? {});

      expect(
        assess(schema(from), schema(to)).map((f) => [f.severity, f.kind, f.diff?.path].join(' ')),
      ).toEqual(expected);
    },
  );

  it('reads a draft 2019-09 tuple', () => {
    const open = referring({}, { type: 'array' });

    expect(severities(open, referring({ items: [{ type: 'string' }] }, { type: 'array' }))).toEqual(
      ['breaking'],
    );

    const tuple = (more: JsonObject) => wrap({ list: { items: [{ type: 'string' }], ...more } });

    expect(severities(tuple({}), tuple({ additionalItems: false }))).toEqual(['breaking']);
    expect(severities(tuple({ additionalItems: false }), tuple({}))).toEqual(['additive']);
    expect(
      severities(tuple({}), wrap({ list: { items: [{ type: 'string' }, { type: 'string' }] } })),
    ).toEqual(['breaking']);
  });

  it.each<[string, (value: JsonValue) => JsonObject]>([
    ['a field', (value) => wrap({ a: value })],
    ['items', (value) => wrap({ list: { type: 'array', items: value } })],
    ['unknown fields', (value) => wrap({ map: { type: 'object', additionalProperties: value } })],
  ])('compares %s that accepts anything with one that does not', (_, schema) => {
    expect(modesBroken(schema(true), schema({ minLength: 2 }))).toEqual(['backward']);
    expect(modesBroken(schema({ minLength: 2 }), schema(true))).toEqual(['forward']);
    expect(modesBroken(schema(true), schema(false))).toContain('backward');
  });

  it.each<[string, { target: JsonObject; sibling: JsonObject }]>([
    [
      'the target’s own',
      {
        target: { unevaluatedProperties: { type: 'string' } },
        sibling: { unevaluatedProperties: false },
      },
    ],
    [
      'additionalProperties',
      { target: { additionalProperties: true }, sibling: { unevaluatedProperties: false } },
    ],
    ['items', { target: { items: { type: 'string' } }, sibling: { unevaluatedItems: false } }],
  ])(
    'finds nothing in an unevaluated keyword that %s leaves nothing for',
    (_, { target, sibling }) => {
      expect(assess(referring({}, target), referring(sibling, target))).toEqual([]);
      expect(assess(referring(sibling, target), referring({}, target))).toEqual([]);
    },
  );

  it('reads an unevaluated keyword that has something left', () => {
    const target = { properties: { a: true } };

    expect(
      modesBroken(referring({}, target), referring({ unevaluatedProperties: false }, target)),
    ).toEqual(['backward']);
  });

  it('reports a field newly required as it stops being described', () => {
    const before = wrap({ a: { type: 'string' } });

    expect(modesBroken(before, { type: 'object', required: ['a'] })).toContain('backward');
  });

  it('keeps what a branch named when it is replaced with one that accepts anything', () => {
    const conditional = { properties: { a: true }, if: { required: ['a'] } };
    const named = { properties: { b: { type: 'string' } } };

    expect(
      severities(
        closing({ ...conditional, else: { properties: { b: true } } }),
        closing({ ...conditional, else: true }),
      ),
    ).toEqual(['breaking']);
    // A predicate that widens can send a value into the stricter branch.
    expect(
      severities(
        wrap({ value: { if: { required: ['a'] }, else: named } }),
        wrap({ value: { if: true, else: named } }),
      ),
    ).toEqual(['breaking']);
  });

  it.each<[string, { before: JsonObject; gained: JsonObject; expected: Array<CompatibilityMode> }]>(
    [
      [
        'a field by a branch',
        {
          before: { unevaluatedProperties: false },
          gained: { allOf: [{ properties: { a: { type: 'string' } } }] },
          expected: ['forward'],
        },
      ],
      [
        'a field',
        {
          before: { unevaluatedProperties: false },
          gained: { properties: { a: { type: 'string' } } },
          expected: ['forward'],
        },
      ],
      [
        'every item',
        { before: { unevaluatedItems: false }, gained: { items: true }, expected: ['forward'] },
      ],
      [
        'items of one type',
        {
          before: { unevaluatedItems: false },
          gained: { items: { type: 'string' } },
          expected: ['forward'],
        },
      ],
      [
        'a field of any type',
        {
          before: { unevaluatedProperties: { type: 'integer' } },
          gained: { properties: { a: true } },
          expected: ['forward'],
        },
      ],
      [
        'a constrained field that another schema governed',
        {
          before: { unevaluatedProperties: { type: 'integer' } },
          gained: { properties: { a: { minimum: 5 } } },
          expected: ['backward', 'forward'],
        },
      ],
      [
        'fields a pattern exempts',
        {
          before: { additionalProperties: false },
          gained: { patternProperties: { '^a': { type: 'string' } } },
          expected: ['forward'],
        },
      ],
      [
        'a field, and requires it',
        {
          before: { unevaluatedProperties: false },
          gained: { allOf: [{ properties: { a: true }, required: ['a'] }] },
          expected: ['backward', 'forward'],
        },
      ],
    ],
  )('breaks the readers that reject %s', (_, { before, gained, expected }) => {
    const [from, to] = [wrap({ value: before }), wrap({ value: { ...before, ...gained } })];

    expect(modesBroken(from, to)).toEqual(expected);
    expect(modesBroken(to, from)).toEqual(
      expect.arrayContaining(expected.length > 1 ? expected : ['backward']),
    );
  });

  it('keeps a sibling that names the only fields allowed', () => {
    const closed = referring({ properties: { id: true }, additionalProperties: false });

    expect(assess(referring({}), closed)).toContainEqual(
      expect.objectContaining({ severity: 'breaking' }),
    );
    expect(assess(closed, referring({ additionalProperties: false }))).not.toEqual([]);
  });

  it('finds nothing in an inline bound that rejects nothing', () => {
    const tags = { type: 'array' };

    expect(
      assess(wrap({ tags }), wrap({ tags: { ...tags, uniqueItems: false, minItems: 0 } })),
    ).toEqual([]);
  });

  it('reads an added constraint as that constraint, and one written inline as no change', () => {
    const named = { $defs: { Name: { type: 'string' } }, type: 'object' };
    const value = { $ref: '#/$defs/Name' };
    const plain = { ...named, properties: { value } };
    const referenced = { ...named, properties: { value: { ...value, maxLength: 5 } } };
    const inline = { ...named, properties: { value: { type: 'string', maxLength: 5 } } };

    expect(assess(plain, referenced).map((f) => f.diff?.detail)).toEqual([
      expect.stringContaining('maxLength'),
    ]);
    expect(assess(inline, referenced)).toEqual([]);
  });
});

it('catches a oneOf branch that stops rejecting everything', () => {
  const before = wrap({ value: { oneOf: [{ type: 'string' }, false] } });
  const after = wrap({ value: { oneOf: [{ type: 'string' }, true] } });

  expect(assess(before, after)).toContainEqual(expect.objectContaining({ severity: 'breaking' }));
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
  const usage = (previous: JsonObject, proposed: JsonObject, fields: Array<string>) =>
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
