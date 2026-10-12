import Ajv from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assessEventChange,
  compatibilityBreaks,
  generateExampleFromSchema,
  isJsonObject,
  jsonValueSchema,
  summariseDrift,
  type JsonObject,
  type JsonValue,
} from '../src/index';

/**
 * Differential test: Ajv decides, the gate is checked against it.
 *
 * Hand-picked cases only find the keyword you thought of, which is how twelve
 * misses shipped across four reviews. Here the oracle is a real validator —
 * if any payload is accepted by one schema and rejected by the other, the gate
 * must report the corresponding compatibility break. Over-reporting is fine;
 * missing one is not.
 */
const ajv = new Ajv({ strict: false, allErrors: false });

const accepts = (schema: JsonObject, payload: JsonValue): boolean => {
  try {
    return ajv.validate(schema, payload) === true;
  } catch {
    // A schema Ajv will not compile cannot be an oracle; those cases are
    // skipped rather than silently counted as agreement.
    return false;
  }
};

const localRef = z.string().startsWith('#/');

/** Follow a local `$ref` so candidates see the constraints a validator sees. */
function deref(root: JsonObject, node: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(node)) return node;
  const ref = localRef.safeParse(node.$ref);

  if (!ref.success) return node;

  const target = ref.data
    .slice(2)
    .split('/')
    .reduce<JsonValue | undefined>((acc, seg) => (isJsonObject(acc) ? acc[seg] : undefined), root);

  const { $ref: _ref, ...siblings } = node;

  return { ...(isJsonObject(target) ? target : undefined), ...siblings };
}

const optionalList = z.array(jsonValueSchema).optional().catch(undefined);

const optionalNumber = z.number().optional().catch(undefined);

/** Keywords whose value is a single nested schema. */
const SUBSCHEMA_KEYWORDS = ['not', 'if', 'then', 'else', 'contains', 'propertyNames'];

/** The keywords the candidate generator reads. A malformed one reads as absent. */
const candidateNode = z
  .object({
    enum: optionalList,
    anyOf: optionalList,
    oneOf: optionalList,
    allOf: optionalList,
    prefixItems: optionalList,
    minimum: optionalNumber,
    maximum: optionalNumber,
    exclusiveMinimum: optionalNumber,
    exclusiveMaximum: optionalNumber,
    maxLength: optionalNumber,
    items: jsonValueSchema.optional(),
  })
  .catch({});

/**
 * Values worth trying for one property: every enum member, both sides of every
 * numeric bound, and a sample of each type. A generator that only emits the
 * first enum value never notices the second one being removed.
 */
function interestingValues(root: JsonObject, raw: JsonValue | undefined): JsonValue[] {
  const resolved = deref(root, raw);
  const node = candidateNode.parse(resolved);
  const values: JsonValue[] = ['x', 1, 0, true, null, [], [1], ['x'], [['x']], [[1]], {}];

  values.push(...(node.enum ?? []));

  for (const bound of [node.minimum, node.maximum, node.exclusiveMinimum, node.exclusiveMaximum]) {
    if (bound !== undefined) values.push(bound - 1, bound, bound + 1);
  }

  if (node.maxLength !== undefined) values.push('y'.repeat(node.maxLength + 1));

  // Every nested schema is a source of discriminating values — including the
  // forbidden ones under `not`, which are exactly what a widened negation
  // starts rejecting.
  for (const branch of [
    ...(node.anyOf ?? []),
    ...(node.oneOf ?? []),
    ...(node.allOf ?? []),
    ...(node.prefixItems ?? []),
    ...SUBSCHEMA_KEYWORDS.flatMap((keyword) => {
      const value = isJsonObject(resolved) ? resolved[keyword] : undefined;

      return isJsonObject(value) ? [value] : [];
    }),
  ]) {
    values.push(...interestingValues(root, branch));
  }

  if (node.items !== undefined) {
    for (const value of interestingValues(root, node.items)) values.push([value]);
  }

  return values;
}

const entriesOf = (value: JsonValue | undefined): Array<[string, JsonValue]> =>
  isJsonObject(value) ? Object.entries(value) : [];

/** Payload candidates drawn from both schemas, plus the obvious edges. */
function candidates(before: JsonObject, after: JsonObject): JsonValue[] {
  const samples: JsonValue[] = [
    generateExampleFromSchema(before),
    generateExampleFromSchema(after),
    {},
    [],
    '',
    0,
    true,
    null,
  ];

  // Names a `patternProperties` key would match. Without one, a change under
  // `^x` is never exercised and every check below quietly early-returns.
  const patternKeys = (schema: JsonObject) =>
    entriesOf(schema.patternProperties).map(
      ([pattern]) => `${pattern.replace(/[^a-zA-Z0-9]/g, '')}1`,
    );

  // One payload per (property, interesting value) across both schemas, so a
  // change to any single field is always exercised by something.
  const keys = new Set([
    ...entriesOf(before.properties).map(([name]) => name),
    ...entriesOf(after.properties).map(([name]) => name),
    ...patternKeys(before),
    ...patternKeys(after),
    'unexpected',
  ]);

  for (const key of keys) {
    const schemaFor = (schema: JsonObject): JsonValue | undefined => {
      const named = isJsonObject(schema.properties) ? schema.properties[key] : undefined;

      if (named !== undefined) return named;

      const pattern = entriesOf(schema.patternProperties).find(([p]) => new RegExp(p).test(key));

      return pattern?.[1] ?? schema.additionalProperties;
    };

    const fromEither = [
      ...interestingValues(before, schemaFor(before)),
      ...interestingValues(after, schemaFor(after)),
    ];

    for (const value of fromEither) samples.push({ [key]: value });
  }

  for (const base of samples.slice(0, 2)) {
    if (!isJsonObject(base)) continue;
    samples.push({ ...base, unexpected: 'x' });

    for (const key of Object.keys(base)) {
      const copy = { ...base };
      delete copy[key];
      samples.push(copy);
    }
  }

  return samples;
}

interface Case {
  name: string;
  before: JsonObject;
  after: JsonObject;
  /**
   * Cases where a payload demonstrably stops validating. Asserted so the
   * harness cannot quietly go vacuous: if the candidates stop discriminating,
   * every check below would early-return and pass while proving nothing.
   */
  oracleFindsBackward?: true;
  /**
   * Severity answers "who does this break?", compatibility answers "can these
   * schemas read each other's data?", and they diverge on purpose. Any case
   * that a validator calls a break while the default gate stays quiet must say
   * so here, so the divergence is a decision on the record rather than a hole.
   */
  severityAdditiveByDesign?: true;
}

const obj = (properties: JsonObject, rest: JsonObject = {}): JsonObject => ({
  type: 'object',
  properties,
  ...rest,
});

/** JSON Schema's `if`/`then`/`else` conditional. */
const conditional = (
  predicate: JsonValue,
  whenTrue: JsonValue,
  whenFalse: JsonValue,
): JsonObject => ({
  if: predicate,
  // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema's `then` keyword, not a Promise
  then: whenTrue,
  else: whenFalse,
});

const cases: Case[] = [
  { name: 'field removed', before: obj({ a: { type: 'string' } }), after: obj({}) },
  {
    name: 'field required',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' } }, { required: ['a'] }),
  },
  {
    name: 'required with no property',
    oracleFindsBackward: true,
    before: obj({}),
    after: obj({}, { required: ['a'] }),
  },
  {
    name: 'type changed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'integer' } }),
  },
  {
    name: 'minimum tightened',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'integer', minimum: 0 } }),
    after: obj({ a: { type: 'integer', minimum: 100 } }),
  },
  {
    name: 'maxLength tightened',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string', maxLength: 50 } }),
    after: obj({ a: { type: 'string', maxLength: 2 } }),
  },
  {
    name: 'enum introduced',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string', enum: ['paid'] } }),
  },
  {
    name: 'enum value removed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string', enum: ['paid', 'failed'] } }),
    after: obj({ a: { type: 'string', enum: ['paid'] } }),
  },
  {
    name: 'enum value added',
    before: obj({ a: { type: 'string', enum: ['paid'] } }),
    after: obj({ a: { type: 'string', enum: ['paid', 'on-hold'] } }),
  },
  {
    name: 'closed object gains a field',
    before: obj({ a: { type: 'string' } }, { additionalProperties: false }),
    after: obj({ a: { type: 'string' }, b: { type: 'string' } }, { additionalProperties: false }),
  },
  {
    name: 'object closed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }, { additionalProperties: true }),
    after: obj({ a: { type: 'string' } }, { additionalProperties: false }),
  },
  {
    name: 'array element type changed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'array', items: { type: 'string' } } }),
    after: obj({ a: { type: 'array', items: { type: 'integer' } } }),
  },
  {
    name: 'array items forbidden',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'array' } }),
    after: obj({ a: { type: 'array', items: false } }),
  },
  {
    name: 'property forbidden',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' }, b: false }),
  },
  {
    name: 'anyOf introduced',
    oracleFindsBackward: true,
    before: obj({ a: {} }),
    after: obj({ a: { anyOf: [{ type: 'string' }] } }),
  },
  {
    name: 'oneOf branch added',
    before: obj({ a: { oneOf: [{ type: 'number' }] } }),
    after: obj({ a: { oneOf: [{ type: 'number' }, { type: 'integer' }] } }),
  },
  {
    name: 'ref target tightened behind an unchanged sibling',
    oracleFindsBackward: true,
    before: {
      $defs: { M: { type: 'integer', minimum: 0 } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/M', minimum: 0 } },
    },
    after: {
      $defs: { M: { type: 'integer', minimum: 100 } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/M', minimum: 0 } },
    },
  },
  {
    name: 'pattern changed',
    before: obj({ a: { type: 'string', pattern: '^a' } }),
    after: obj({ a: { type: 'string', pattern: '^b' } }),
  },
  {
    name: 'nested array element type changed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }),
    after: obj({ a: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } }),
  },
  {
    name: 'oneOf branch content widened',
    oracleFindsBackward: true,
    before: obj({ a: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['a'] }] } }),
    after: obj({ a: { oneOf: [{ type: 'number' }, { enum: ['a', 1] }] } }),
  },
  {
    name: 'intermediate $ref constraint tightened',
    oracleFindsBackward: true,
    before: {
      $defs: { B: { type: 'integer' }, A: { $ref: '#/$defs/B', minimum: 0 } },
      type: 'object',
      properties: { value: { $ref: '#/$defs/A' } },
    },
    after: {
      $defs: { B: { type: 'integer' }, A: { $ref: '#/$defs/B', minimum: 100 } },
      type: 'object',
      properties: { value: { $ref: '#/$defs/A' } },
    },
  },
  {
    name: 'minProperties added',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' } }, { minProperties: 1 }),
  },
  {
    name: 'dependentRequired added',
    oracleFindsBackward: true,
    before: obj({ card: { type: 'string' }, billing: { type: 'string' } }),
    after: obj(
      { card: { type: 'string' }, billing: { type: 'string' } },
      { dependentRequired: { card: ['billing'] } },
    ),
  },
  {
    name: 'propertyNames restricted',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' } }, { propertyNames: { pattern: '^z' } }),
  },
  {
    name: 'description changed is not a contract change',
    before: obj({ a: { type: 'string', description: 'before' } }),
    after: obj({ a: { type: 'string', description: 'after' } }),
  },
  {
    name: 'optional typed field added to an open object',
    oracleFindsBackward: true,
    // Adding an optional field is the commonest schema change there is.
    // BACKWARD reports it; failing the default gate on it would get the gate
    // switched off, which protects nothing.
    severityAdditiveByDesign: true,
    before: { type: 'object' },
    after: obj({ note: { type: 'string' } }),
  },
  {
    name: 'required field removed from a closed object',
    before: obj({ id: { type: 'string' } }, { required: ['id'], additionalProperties: false }),
    after: obj({}, { additionalProperties: false }),
  },
  {
    name: 'anchor target tightened',
    oracleFindsBackward: true,
    before: {
      $defs: { M: { $anchor: 'amount', type: 'integer', minimum: 0 } },
      type: 'object',
      properties: { value: { $ref: '#amount' } },
    },
    after: {
      $defs: { M: { $anchor: 'amount', type: 'integer', minimum: 100 } },
      type: 'object',
      properties: { value: { $ref: '#amount' } },
    },
  },
  {
    name: 'named field contradicts an inherited additionalProperties schema',
    before: obj({}, { additionalProperties: { type: 'string' } }),
    after: obj({ note: { type: 'number' } }, { additionalProperties: { type: 'string' } }),
  },
  {
    name: 'ref inside additionalProperties tightened',
    oracleFindsBackward: true,
    before: {
      $defs: { Amount: { type: 'integer', minimum: 0 } },
      type: 'object',
      additionalProperties: { $ref: '#/$defs/Amount' },
    },
    after: {
      $defs: { Amount: { type: 'integer', minimum: 100 } },
      type: 'object',
      additionalProperties: { $ref: '#/$defs/Amount' },
    },
  },
  {
    name: 'additionalProperties schema introduced',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' } }, { additionalProperties: { type: 'string' } }),
  },
  {
    name: 'ref inside patternProperties tightened',
    oracleFindsBackward: true,
    before: {
      $defs: { Amount: { type: 'integer', minimum: 0 } },
      type: 'object',
      patternProperties: { '^x': { $ref: '#/$defs/Amount' } },
    },
    after: {
      $defs: { Amount: { type: 'integer', minimum: 100 } },
      type: 'object',
      patternProperties: { '^x': { $ref: '#/$defs/Amount' } },
    },
  },
  {
    name: 'ref inside prefixItems tightened',
    oracleFindsBackward: true,
    before: {
      $defs: { Amount: { type: 'integer', minimum: 0 } },
      type: 'object',
      properties: { list: { type: 'array', prefixItems: [{ $ref: '#/$defs/Amount' }] } },
    },
    after: {
      $defs: { Amount: { type: 'integer', minimum: 100 } },
      type: 'object',
      properties: { list: { type: 'array', prefixItems: [{ $ref: '#/$defs/Amount' }] } },
    },
  },
  {
    name: 'propertyNames introduced',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }),
    after: obj({ a: { type: 'string' } }, { propertyNames: { pattern: '^a$' } }),
  },
  {
    name: 'not introduced',
    oracleFindsBackward: true,
    before: obj({ a: {} }),
    after: obj({ a: { not: { type: 'string' } } }),
  },
  {
    name: 'forbidden set widened under not',
    oracleFindsBackward: true,
    before: obj({ a: { not: { enum: [1] } } }),
    after: obj({ a: { not: { enum: [1, 2] } } }),
  },
  {
    name: 'forbidden set narrowed under not',
    before: obj({ a: { not: { enum: [1, 2] } } }),
    after: obj({ a: { not: { enum: [1] } } }),
  },
  {
    name: 'unevaluatedProperties closed',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }, { unevaluatedProperties: true }),
    after: obj({ a: { type: 'string' } }, { unevaluatedProperties: false }),
  },
  {
    name: 'not flipped from false to true',
    oracleFindsBackward: true,
    before: obj({ a: { not: false } }),
    after: obj({ a: { not: true } }),
  },
  {
    name: 'unevaluatedProperties from true to a schema',
    oracleFindsBackward: true,
    before: obj({ a: { type: 'string' } }, { unevaluatedProperties: true }),
    after: obj({ a: { type: 'string' } }, { unevaluatedProperties: { type: 'string' } }),
  },
  {
    name: 'not from false to a schema',
    oracleFindsBackward: true,
    before: obj({ a: { not: false } }),
    after: obj({ a: { not: { type: 'number' } } }),
  },
  {
    name: 'not from a schema to false',
    before: obj({ a: { not: { type: 'number' } } }),
    after: obj({ a: { not: false } }),
  },
  {
    name: 'conditional predicate widened',
    oracleFindsBackward: true,
    before: obj({ a: conditional({ enum: [1] }, false, true) }),
    after: obj({ a: conditional({ enum: [1, 2] }, false, true) }),
  },
  {
    name: 'conditional predicate widened with permissive branches',
    before: obj({ a: conditional({ enum: [1] }, true, true) }),
    after: obj({ a: conditional({ enum: [1, 2] }, true, true) }),
  },
  {
    name: 'conditional predicate widened with identical branches',
    before: obj({ a: conditional({ enum: [1] }, { type: 'number' }, { type: 'number' }) }),
    after: obj({ a: conditional({ enum: [1, 2] }, { type: 'number' }, { type: 'number' }) }),
  },
];

describe.each(cases)(
  '$name',
  ({ before, after, oracleFindsBackward, severityAdditiveByDesign }) => {
    const payloads = candidates(before, after);
    // Backward: a new reader must read old data. Forward: an old reader must
    // read new data. Ajv says whether either is actually impossible.
    const backwardBroken = payloads.some((p) => accepts(before, p) && !accepts(after, p));
    const forwardBroken = payloads.some((p) => accepts(after, p) && !accepts(before, p));

    const report = summariseDrift(
      assessEventChange({
        domain: 'd',
        eventId: 'e',
        consumers: ['c'],
        previous: before,
        proposed: after,
      }),
    );

    it('has payloads that actually discriminate', () => {
      if (!oracleFindsBackward) return;
      expect(backwardBroken).toBe(true);
    });

    it('reports a BACKWARD break whenever a real payload stops validating', () => {
      if (!backwardBroken) return;
      expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    });

    it('reports a FORWARD break whenever new data fails the old schema', () => {
      if (!forwardBroken) return;
      expect(compatibilityBreaks(report, 'forward').length).toBeGreaterThan(0);
    });

    it('fails the default gate whenever anything stopped validating', () => {
      if (!backwardBroken) return;
      expect(report.hasBreaking).toBe(!severityAdditiveByDesign);
    });
  },
);

// The conservative fallback reports any keyword it does not model. That is the
// right default for a gate and the wrong one for prose: if editing a
// description fails CI, teams turn the gate off.
describe('annotations are not contract changes', () => {
  const unchanged = (before: JsonObject, after: JsonObject) =>
    summariseDrift(
      assessEventChange({
        domain: 'd',
        eventId: 'e',
        consumers: ['c'],
        previous: before,
        proposed: after,
      }),
    );

  it.each([
    [
      'permissive branches',
      conditional({ enum: [1] }, true, true),
      conditional({ enum: [1, 2] }, true, true),
    ],
    [
      'identical branches',
      conditional({ enum: [1] }, { type: 'number' }, { type: 'number' }),
      conditional({ enum: [1, 2] }, { type: 'number' }, { type: 'number' }),
    ],
  ])('does not fail the gate on a predicate edit with %s', (_name, before, after) => {
    // Both schemas accept exactly the same values, so the predicate is noise.
    const report = unchanged(
      { type: 'object', properties: { a: before } },
      { type: 'object', properties: { a: after } },
    );

    expect(report.hasBreaking).toBe(false);
    expect(compatibilityBreaks(report, 'full')).toHaveLength(0);
  });

  it('still fails when a branch actually constrains', () => {
    const report = unchanged(
      obj({ a: conditional({ enum: [1] }, false, true) }),
      obj({ a: conditional({ enum: [1, 2] }, false, true) }),
    );

    expect(report.hasBreaking).toBe(true);
  });

  it('does not fail the gate on a description inside a oneOf branch', () => {
    const branch = (description: string): JsonObject => ({
      type: 'object',
      properties: { a: { oneOf: [{ type: 'number', description }, { type: 'string' }] } },
    });

    const report = unchanged(branch('before'), branch('after'));
    expect(report.hasBreaking).toBe(false);
    expect(compatibilityBreaks(report, 'full')).toHaveLength(0);
  });

  it.each([
    ['description', { description: 'a' }, { description: 'b' }],
    ['title', { title: 'a' }, { title: 'b' }],
    ['examples', { examples: [1] }, { examples: [2] }],
    ['default', { default: 1 }, { default: 2 }],
    ['$comment', { $comment: 'a' }, { $comment: 'b' }],
    ['deprecated', {}, { deprecated: true }],
    ['a vendor extension', { 'x-team': 'a' }, { 'x-team': 'b' }],
  ])('does not fail the gate on %s', (_name, before, after) => {
    const report = unchanged(
      { type: 'object', properties: { a: { type: 'string', ...before } } },
      { type: 'object', properties: { a: { type: 'string', ...after } } },
    );

    expect(report.hasBreaking).toBe(false);
  });
});
