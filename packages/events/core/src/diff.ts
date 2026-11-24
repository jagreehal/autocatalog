import { z } from 'zod';
import type { JsonPrimitive } from './json';

export type DiffKind =
  | 'constraint_changed'
  | 'added'
  | 'removed'
  | 'type_changed'
  | 'required_added'
  | 'required_removed'
  | 'description_changed'
  | 'enum_changed'
  | 'format_changed'
  | 'meaning_changed';

export interface DiffResult {
  kind: DiffKind;
  path: string;
  detail: string;
  /**
   * Whether the field was required before ('removed') or is required now
   * ('added'). Which side of compatibility a change lands on depends on it:
   * dropping an optional field is forward-compatible, dropping a required one
   * is not.
   */
  wasRequired?: boolean;
  /**
   * Structured enum evidence. Compatibility is decided from these, never from
   * `detail`: an enum value containing a hyphen made a widening look like a
   * narrowing when the classifier searched the human-readable text.
   */
  enumAdded?: Array<unknown>;
  enumRemoved?: Array<unknown>;
  /** An unconstrained field gained an enum — a restriction, not an addition. */
  enumIntroduced?: boolean;
  enumDropped?: boolean;
  /**
   * Whether the object that gained this field refused unknown properties
   * before the change. A new field in a closed object is rejected by the old
   * schema, so optionality alone does not make it compatible.
   */
  containerClosedBefore?: boolean;
  /** The added property constrains a field the old schema accepted freely. */
  constrainsPreviouslyFree?: boolean;
  /** The added property schema is `false`: carrying the field is now invalid. */
  propertyForbidden?: boolean;
  /** Whether the object that lost this field refuses unknown properties now. */
  containerClosedAfter?: boolean;
  /** Whether an `unevaluatedProperties` says what this field may hold now. */
  containerGovernedAfter?: boolean;
  /** Which keyword moved, and whether it admits fewer values than before. */
  constraint?: {
    keyword: string;
    previous?: SchemaValue;
    current?: SchemaValue;
    direction: 'tightened' | 'loosened' | 'changed';
  };
  /**
   * Whether the new type set admits every type the old one did ('widened'),
   * only some of them ('narrowed'), or neither. `integer → number` widens.
   */
  typeDirection?: 'widened' | 'narrowed' | 'changed';
  isRequired?: boolean;
  /** Which `x-meaning` assumption moved: changed, dropped, or declared for the first time. */
  meaning?: { key: string; previous?: string; current?: string };
}

/** Anything that can sit under a schema keyword: a subschema, a list, or plain JSON. */
export type SchemaValue = JsonPrimitive | SchemaNode | Array<SchemaValue>;

/**
 * A JSON Schema object. The keywords the comparison reads are typed; any other
 * keyword is still reachable, because an unmodelled keyword is still enforced.
 */
export interface SchemaNode {
  [keyword: string]: SchemaValue | undefined;
  type?: string | Array<string>;
  // `properties: { blocked: false }` is legal: an entry can be a boolean schema.
  properties?: Record<string, SchemaNode | boolean>;
  items?: SchemaNode | boolean;
  required?: Array<string>;
  description?: string;
  enum?: Array<SchemaValue>;
  format?: string;
  $ref?: string;
  $anchor?: string;
  additionalProperties?: SchemaNode | boolean;
  not?: SchemaNode | boolean;
  if?: SchemaNode | boolean;
  then?: SchemaNode | boolean;
  else?: SchemaNode | boolean;
  contains?: SchemaNode | boolean;
  propertyNames?: SchemaNode | boolean;
  additionalItems?: SchemaNode | boolean;
  unevaluatedItems?: SchemaNode | boolean;
  unevaluatedProperties?: SchemaNode | boolean;
  prefixItems?: Array<SchemaNode | boolean>;
  patternProperties?: Record<string, SchemaNode | boolean>;
  dependentSchemas?: Record<string, SchemaNode | boolean>;
  anyOf?: Array<SchemaNode>;
  oneOf?: Array<SchemaNode>;
  allOf?: Array<SchemaNode>;
  minimum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  minItems?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  maxLength?: number;
  maxItems?: number;
  minProperties?: number;
  maxProperties?: number;
  pattern?: string;
  const?: SchemaValue;
  multipleOf?: number;
  uniqueItems?: boolean;
}

const schemaObject = z.looseObject({});

/** An object under a keyword, as opposed to a boolean schema, a list or a scalar. */
export const isSchemaNode = (value: SchemaValue | undefined): value is SchemaNode =>
  schemaObject.safeParse(value).success;

const isBooleanSchema = (value: SchemaValue | undefined): value is boolean =>
  value === true || value === false;

/** The value read as a schema, or `undefined` when it is not one. */
const asSchema = (value: SchemaValue | undefined): SchemaNode | boolean | undefined =>
  isBooleanSchema(value) || isSchemaNode(value) ? value : undefined;

/**
 * Depth cap for the recursive walk. A resolved schema is a finite tree — an
 * unresolved `$ref` cycle stays a `$ref` node and is never followed — so this
 * only exists so a pathological generated schema cannot stall CI.
 */
const MAX_DEPTH = 24;

const KIND_ORDER: Array<DiffKind> = [
  'removed',
  'added',
  'constraint_changed',
  'type_changed',
  'required_added',
  'required_removed',
  'format_changed',
  'enum_changed',
  'meaning_changed',
  'description_changed',
];

/**
 * `x-meaning` on a field: what its value means, which no validator checks. A
 * number in pounds and one in pence pass the same schema.
 */
const meaningOf = (node: SchemaNode): Record<string, string> =>
  // A value that is not text is left out; the rest still count.
  Object.fromEntries(
    Object.entries(isSchemaNode(node['x-meaning']) ? node['x-meaning'] : {}).flatMap(
      ([key, value]) => {
        const text = z.string().safeParse(value);

        return text.success ? [[key, text.data]] : [];
      },
    ),
  );

/** Kinds that change nothing a validator sees. */
const isAnnotation = (finding: DiffResult): boolean =>
  finding.kind === 'description_changed' || finding.kind === 'meaning_changed';

export function typeLabel(s: SchemaNode | boolean | undefined): string {
  // JSON Schema allows a boolean where a schema is expected. `false` rejects
  // every value, so reading it as "no schema here" hides the most restrictive
  // change there is.
  if (s === true) {
    return 'any';
  }

  if (s === false) {
    return 'never';
  }

  if (!s) {
    return 'unknown';
  }

  if (Array.isArray(s.type)) {
    return s.type.join(' | ');
  }

  if (s.type !== undefined) {
    return s.type;
  }

  if (s.enum) {
    return 'enum';
  }

  return 'unknown';
}

/** The JSON types a schema admits, or `undefined` when it admits any type. */
function typesOf(s: SchemaNode | boolean | undefined): Set<string> | undefined {
  if (s === false) {
    return new Set();
  }

  if (s === true || s?.type === undefined) {
    return undefined;
  }

  return new Set(Array.isArray(s.type) ? s.type : [s.type]);
}

/** Whether `outer` admits every type `inner` does. `number` covers `integer`. */
const coversTypes = (outer: Set<string> | undefined, inner: Set<string> | undefined): boolean =>
  outer === undefined ||
  (inner !== undefined &&
    [...inner].every((type) => outer.has(type) || (type === 'integer' && outer.has('number'))));

/**
 * Which way the admitted types moved, or `undefined` when they did not.
 * Compared as sets: `["string", "null"]` reordered is the same type.
 * Set comparison adapted from EventCatalog's @eventcatalog/diff (MIT).
 */
export function typeDirection(
  previous: SchemaNode | boolean | undefined,
  current: SchemaNode | boolean | undefined,
): DiffResult['typeDirection'] {
  const before = typesOf(previous);
  const after = typesOf(current);
  const widens = coversTypes(after, before);
  const narrows = coversTypes(before, after);

  if (widens && narrows) {
    return undefined;
  }

  return widens ? 'widened' : narrows ? 'narrowed' : 'changed';
}

/** A type finding, or `null` when the admitted types are the same set. */
function typeChange(
  previous: SchemaNode | boolean | undefined,
  current: SchemaNode | boolean | undefined,
  path: string,
): DiffResult | null {
  const direction = typeDirection(previous, current);

  if (direction === undefined) {
    return null;
  }

  return {
    kind: 'type_changed',
    path,
    detail: `${typeLabel(previous)} → ${typeLabel(current)}`,
    typeDirection: direction,
  };
}

type ValuePair = [SchemaValue | undefined, SchemaValue | undefined];

const definedKeys = (node: SchemaNode) =>
  Object.keys(node).filter((key) => node[key] !== undefined);

/** What must be the same inside two values for them to be, or undefined when they are not. */
function pairsWithin([a, b]: ValuePair): Array<ValuePair> | undefined {
  if (a === b) {
    return [];
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length ? a.map((value, i): ValuePair => [value, b[i]]) : undefined;
  }

  if (!isSchemaNode(a) || !isSchemaNode(b)) {
    return undefined;
  }

  const keys = definedKeys(a);

  return keys.length === definedKeys(b).length && keys.every((key) => b[key] !== undefined)
    ? keys.map((key): ValuePair => [a[key], b[key]])
    : undefined;
}

/** Whether two values are the same JSON, in any order of fields and at any depth. */
function sameValue(a: SchemaValue | undefined, b: SchemaValue | undefined): boolean {
  const pending: Array<ValuePair> = [[a, b]];

  for (let pair = pending.pop(); pair; pair = pending.pop()) {
    const within = pairsWithin(pair);

    if (!within) {
      return false;
    }

    for (const next of within) {
      pending.push(next);
    }
  }

  return true;
}

function arraysEqual(a: Array<SchemaValue>, b: Array<SchemaValue>): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((v, i) => sameValue(v, b[i]));
}

interface EnumDiff {
  detail: string;
  added: Array<unknown>;
  removed: Array<unknown>;
  introduced: boolean;
  dropped: boolean;
}

/** A value with whatever is nested deeper than the walk goes left out. */
function shallow(value: SchemaValue, depth = 0): SchemaValue {
  if (!Array.isArray(value) && !isSchemaNode(value)) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '…';
  }

  return Array.isArray(value)
    ? value.map((item) => shallow(item, depth + 1))
    : Object.fromEntries(
        definedKeys(value).map((key) => [key, shallow(value[key] ?? null, depth + 1)]),
      );
}

const printed = (value: SchemaValue | undefined) => JSON.stringify(shallow(value ?? null));

const show = (values: Array<SchemaValue>) => values.map((value) => printed(value)).join(', ');

function diffEnums(
  prev: Array<SchemaValue> | undefined,
  next: Array<SchemaValue> | undefined,
): EnumDiff | null {
  if (!prev && !next) {
    return null;
  }

  // Constraining a field that accepted anything is a restriction: payloads that
  // were valid yesterday can be rejected today.
  if (!prev && next) {
    return {
      detail: `added enum [${show(next)}]`,
      added: next,
      removed: [],
      introduced: true,
      dropped: false,
    };
  }

  if (prev && !next) {
    return {
      detail: `removed enum [${show(prev)}]`,
      added: [],
      removed: [],
      introduced: false,
      dropped: true,
    };
  }

  if (prev && next) {
    if (arraysEqual(prev, next)) {
      return null;
    }

    const added = next.filter((v) => !prev.some((p) => sameValue(p, v)));
    const removed = prev.filter((v) => !next.some((n) => sameValue(n, v)));
    const parts: Array<string> = [];

    if (added.length) {
      parts.push(`+${show(added)}`);
    }

    if (removed.length) {
      parts.push(`-${show(removed)}`);
    }

    return { detail: parts.join(' '), added, removed, introduced: false, dropped: false };
  }

  return null;
}

/**
 * Validation keywords that decide whether a payload is accepted, and which
 * direction each one tightens in. Comparing only `type` and `properties` lets
 * `minimum: 0 → 100` through as no change at all.
 */
const NUMERIC_TIGHTENS_UP = [
  'minimum',
  'exclusiveMinimum',
  'minLength',
  'minItems',
  'minProperties',
] as const;

const NUMERIC_TIGHTENS_DOWN = [
  'maximum',
  'exclusiveMaximum',
  'maxLength',
  'maxItems',
  'maxProperties',
] as const;

const EXACT_KEYWORDS = ['pattern', 'const', 'multipleOf', 'uniqueItems'] as const;

/** Whether a keyword is absent, or at the value every payload meets. */
function rejectsNothing(keyword: string, value: SchemaValue | undefined): boolean {
  switch (keyword) {
    case 'uniqueItems':
      return value === undefined || value === false;
    case 'minLength':
    case 'minItems':
    case 'minProperties':
      return value === undefined || value === 0;
    case 'required':
      return value === undefined || (Array.isArray(value) && value.length === 0);
    default:
      return value === undefined;
  }
}

/**
 * `tightens` says whether moving from `previous` to `current` admits fewer
 * values; without it a change can go either way.
 */
function constraintDirection<T extends SchemaValue>(
  keyword: string,
  previous: T | undefined,
  current: T | undefined,
  tightens?: (previous: T, current: T) => boolean | undefined,
): DiffResult['constraint'] | null {
  if (sameValue(previous, current)) {
    return null;
  }

  if (rejectsNothing(keyword, previous) && rejectsNothing(keyword, current)) {
    return null;
  }

  const base = { keyword, previous, current };

  // Adding a bound where there was none only ever removes freedom; dropping one
  // only ever adds it.
  if (previous === undefined) {
    return { ...base, direction: 'tightened' };
  }

  if (current === undefined) {
    return { ...base, direction: 'loosened' };
  }

  const tighter = tightens?.(previous, current);

  if (tighter !== undefined) {
    return { ...base, direction: tighter ? 'tightened' : 'loosened' };
  }

  // A changed pattern or multipleOf can go either way and no cheap analysis
  // says which, so it is reported rather than guessed at. So can a bound
  // that is not a number on both sides, such as draft-04's boolean
  // exclusiveMaximum.
  return { ...base, direction: 'changed' };
}

const numberPair = z.tuple([z.number(), z.number()]);

/** A comparison of two bounds that only answers when both are numbers. */
const numeric =
  (tightens: (previous: number, current: number) => boolean) =>
  (previous: SchemaValue, current: SchemaValue): boolean | undefined => {
    const pair = numberPair.safeParse([previous, current]);

    return pair.success ? tightens(...pair.data) : undefined;
  };

/**
 * Keywords that carry no validation weight. Everything here can change freely.
 */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$anchor',
  '$comment',
  '$defs',
  'definitions',
  'title',
  'description',
  'examples',
  'example',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

/**
 * Keywords whose value is itself a schema, a list of schemas, or a map of them.
 *
 * These are walked rather than string-compared: the text of a `$ref` inside
 * `patternProperties` does not change when its target tightens, so comparing
 * the container as JSON reports nothing at all. Anywhere a schema can appear,
 * the walk has to reach it.
 */
const SCHEMA_KEYWORDS = [
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'additionalItems',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const;

const SCHEMA_LIST_KEYWORDS = ['prefixItems'] as const;

const SCHEMA_MAP_KEYWORDS = ['patternProperties', 'dependentSchemas'] as const;

/** Keywords compared explicitly above, with a known direction. */
const UNDERSTOOD_KEYWORDS = new Set([
  'type',
  'enum',
  'format',
  'properties',
  'required',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
  'additionalProperties',
  ...SCHEMA_KEYWORDS,
  ...SCHEMA_LIST_KEYWORDS,
  ...SCHEMA_MAP_KEYWORDS,
]);

const CONSTRAINT_KEYWORDS = new Set<string>([
  ...NUMERIC_TIGHTENS_UP,
  ...NUMERIC_TIGHTENS_DOWN,
  ...EXACT_KEYWORDS,
]);

/**
 * Compare one node against its counterpart: its own type, description, format,
 * enum and validation keywords.
 *
 * Called for every property, for array `items`, and for the root. The previous
 * version compared a node's children but never the node itself, so an array
 * whose items changed from string to integer produced no findings at all.
 */
function compareNode(
  previous: SchemaNode,
  current: SchemaNode,
  path: string,
  results: Array<DiffResult>,
): void {
  const type = typeChange(previous, current, path);

  if (type) {
    results.push(type);
  }

  // A `$ref` still here after resolution points outside this document, so its
  // target cannot be compared. A different target can be any schema at all.
  if (previous.$ref !== current.$ref) {
    results.push({
      kind: 'constraint_changed',
      path,
      detail: `$ref ${previous.$ref ?? '∅'} → ${current.$ref ?? '∅'}`,
      constraint: {
        keyword: '$ref',
        previous: previous.$ref,
        current: current.$ref,
        direction: 'changed',
      },
    });
  }

  if ((previous.description ?? '') !== (current.description ?? '')) {
    results.push({
      kind: 'description_changed',
      path,
      detail: `${previous.description ?? '∅'} → ${current.description ?? '∅'}`,
    });
  }

  if ((previous.format ?? '') !== (current.format ?? '')) {
    results.push({
      kind: 'format_changed',
      path,
      detail: `${previous.format ?? '∅'} → ${current.format ?? '∅'}`,
      // Adding a format rejects values that were accepted; dropping one only
      // accepts more. Swapping one for another can go either way.
      constraint: constraintDirection('format', previous.format, current.format) ?? undefined,
    });
  }

  const [meantBefore, meantNow] = [meaningOf(previous), meaningOf(current)];

  for (const key of [...new Set([...Object.keys(meantBefore), ...Object.keys(meantNow)])].sort()) {
    const [before, now] = [meantBefore[key], meantNow[key]];

    if (before === now) {
      continue;
    }

    results.push({
      kind: 'meaning_changed',
      path,
      detail: `${key}: ${before ?? '∅'} → ${now ?? '∅'}`,
      meaning: {
        key,
        ...(before !== undefined && { previous: before }),
        ...(now !== undefined && { current: now }),
      },
    });
  }

  const enumDiff = diffEnums(previous.enum, current.enum);

  if (enumDiff) {
    results.push({
      kind: 'enum_changed',
      path,
      detail: enumDiff.detail,
      enumAdded: enumDiff.added,
      enumRemoved: enumDiff.removed,
      enumIntroduced: enumDiff.introduced,
      enumDropped: enumDiff.dropped,
    });
  }

  // Any validation keyword this comparison does not model is still a keyword a
  // validator enforces. Treating "we have no rule for it" as "nothing changed"
  // is how `minProperties` and `dependentRequired` slipped through; the safe
  // default for a gate is to report it and let a human clear it.
  for (const keyword of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (ANNOTATION_KEYWORDS.has(keyword) || UNDERSTOOD_KEYWORDS.has(keyword)) {
      continue;
    }

    if (CONSTRAINT_KEYWORDS.has(keyword)) {
      continue;
    }

    if (keyword.startsWith('x-')) {
      continue;
    }

    const before = previous[keyword];
    const after = current[keyword];

    if (sameValue(before, after)) {
      continue;
    }

    results.push({
      kind: 'constraint_changed',
      path,
      detail: `${keyword} ${printed(before)} → ${printed(after)}`,
      constraint: { keyword, previous: before, current: after, direction: 'changed' },
    });
  }

  const constraints = [
    ...NUMERIC_TIGHTENS_UP.map((keyword) =>
      constraintDirection(
        keyword,
        previous[keyword],
        current[keyword],
        numeric((was, now) => now > was),
      ),
    ),
    ...NUMERIC_TIGHTENS_DOWN.map((keyword) =>
      constraintDirection(
        keyword,
        previous[keyword],
        current[keyword],
        numeric((was, now) => now < was),
      ),
    ),
    constraintDirection('pattern', previous.pattern, current.pattern),
    constraintDirection('const', previous.const, current.const),
    constraintDirection('multipleOf', previous.multipleOf, current.multipleOf),
    constraintDirection('uniqueItems', previous.uniqueItems, current.uniqueItems, (_, now) => now),
  ];

  for (const constraint of constraints) {
    if (constraint) {
      const { keyword } = constraint;
      results.push({
        kind: 'constraint_changed',
        path,
        detail: `${keyword} ${printed(constraint.previous)} → ${printed(constraint.current)}`,
        constraint,
      });
    }
  }
}

/**
 * Which way a change to a composition keyword moves.
 *
 * Counting branches is not enough. `anyOf` is a union and grows monotonically,
 * `allOf` is an intersection and shrinks as it grows — but `oneOf` demands
 * *exactly one* match, so an added branch can reject a value that now matches
 * two. And introducing any of them over an unconstrained field is a
 * restriction however many branches it has.
 */
function unionDirection(
  keyword: 'anyOf' | 'oneOf',
  branches: {
    existedBefore: boolean;
    existsNow: boolean;
    before: number;
    after: number;
    /** Which way gaining or losing the keyword moves. */
    gained: Direction;
    lost: Direction;
  },
): Direction {
  if (!branches.existedBefore && branches.existsNow) {
    return branches.gained;
  }

  if (branches.existedBefore && !branches.existsNow) {
    return branches.lost;
  }

  if (keyword === 'oneOf') {
    return 'changed';
  }

  return branches.after > branches.before ? 'loosened' : 'tightened';
}

interface WalkRoots {
  previous: SchemaNode;
  current: SchemaNode;
  /** The `unevaluated` keywords around each schema, for the same value. */
  readers: { previous: Readers; current: Readers };
}

/**
 * Resolve a local `$ref` so the comparison sees the schema a validator sees.
 *
 * A tightened constraint inside `$defs` is invisible to a walk that stops at
 * the `$ref` node, and that is where shared types live. Recursive schemas make
 * `derefLocal` throw rather than hang; an unresolvable pointer is left as-is so
 * one bad reference cannot take the whole diff down.
 */
/** Find the subschema carrying `$anchor: name`, wherever it is declared. */
function anchorTarget(
  node: SchemaValue | undefined,
  name: string,
  depth = 0,
): SchemaNode | undefined {
  if (depth > MAX_DEPTH) {
    return undefined;
  }

  if (isSchemaNode(node) && node.$anchor === name) {
    return node;
  }

  const children = Array.isArray(node) ? node : isSchemaNode(node) ? Object.values(node) : [];

  for (const value of children) {
    const found = anchorTarget(value, name, depth + 1);

    if (found) {
      return found;
    }
  }

  return undefined;
}

/**
 * Whether unknown properties are restricted: `false` forbids them outright, and
 * a schema constrains what they may hold. Only `true`, `{}` or an absent
 * keyword leaves them free.
 */
function restrictsUnknownProperties(node: SchemaNode): boolean {
  const additional = node.additionalProperties;

  if (additional === undefined || additional === true) {
    return false;
  }

  if (additional === false) {
    return true;
  }

  return constrainsValues(additional);
}

/**
 * Whether editing `if` can change which payloads are accepted.
 *
 * It cannot when neither branch constrains anything — `then`/`else` absent,
 * `true` or `{}` — because every value is accepted either way. Nor when the two
 * branches are identical, since the predicate then decides between equals.
 * Reporting those as unprovable is a false alarm, and false alarms are how a
 * gate gets switched off.
 */
function predicateCanMatter(previous: SchemaNode, current: SchemaNode): boolean {
  const branchesIrrelevant = (node: SchemaNode): boolean => {
    const thenBranch = node.then;
    const elseBranch = node.else;

    if (!constrainsValues(thenBranch) && !constrainsValues(elseBranch)) {
      return true;
    }

    return sameValue(thenBranch, elseBranch);
  };

  return !(branchesIrrelevant(previous) && branchesIrrelevant(current));
}

/**
 * How much a subschema lets through, as an order: `true` accepts anything, an
 * object accepts some of it, `false` accepts nothing. Under `not` the ends
 * swap, because `not: false` forbids nothing and `not: true` forbids everything.
 */
function permissiveness(node: SchemaValue, inverts: boolean): number {
  if (node === true) {
    return inverts ? 0 : 2;
  }

  if (node === false) {
    return inverts ? 2 : 0;
  }

  return 1;
}

/** What a schema says of the properties it does not name, and the names that exempts. */
const unknownIn = ({
  properties,
  patternProperties,
  additionalProperties,
}: SchemaNode): SchemaNode => ({
  ...(properties && {
    properties: Object.fromEntries(Object.keys(properties).map((name) => [name, true])),
  }),
  ...(patternProperties && {
    patternProperties: Object.fromEntries(
      Object.keys(patternProperties).map((name) => [name, true]),
    ),
  }),
  ...(additionalProperties !== undefined && { additionalProperties }),
});

/** The schema an object applies to properties it does not name, if any. */
function effectiveUnknown(node: SchemaNode): SchemaNode | undefined {
  const additional = node.additionalProperties;

  return isBooleanSchema(additional) ? undefined : additional;
}

const isAnnotationKeyword = (keyword: string): boolean =>
  ANNOTATION_KEYWORDS.has(keyword) || keyword.startsWith('x-');

/** Whether a schema restricts anything at all, as opposed to `true` or `{}`. */
function constrainsValues(node: SchemaNode | boolean | undefined): boolean {
  if (node === false) {
    return true;
  }

  if (node === true || node === undefined) {
    return false;
  }

  return Object.keys(node).some((keyword) => !isAnnotationKeyword(keyword));
}

function pointer(root: SchemaNode, ref: string): SchemaNode | undefined {
  // `#/a/b` is a JSON pointer; `#name` is a named anchor. Supporting only the
  // first leaves a valid reference silently uncompared.
  if (ref.startsWith('#/')) {
    const target = ref
      .slice(2)
      .split('/')
      .reduce<SchemaValue | undefined>((acc, seg) => {
        const token = seg.replaceAll('~1', '/').replaceAll('~0', '~');

        if (Array.isArray(acc)) {
          return acc[Number(token)];
        }

        return isSchemaNode(acc) ? acc[token] : undefined;
      }, root);

    return isSchemaNode(target) ? target : undefined;
  }

  if (ref.startsWith('#') && ref.length > 1) {
    return anchorTarget(root, ref.slice(1));
  }

  return undefined;
}

/** Whether a schema accepts anything; a list, such as draft 2019-09's tuple, is not a schema. */
const anySchema = (value: SchemaValue | undefined) =>
  value === undefined || (asSchema(value) !== undefined && !constrainsValues(asSchema(value)));

const everySchema = (value: SchemaValue | undefined) =>
  isSchemaNode(value) && Object.values(value).every((schema) => anySchema(schema));

/** The keywords that hold schemas, and when those reject nothing. */
const INERT = new Map<string, (value: SchemaValue | undefined) => boolean>([
  ['propertyNames', anySchema],
  ['dependentSchemas', everySchema],
  ['not', (value) => value === false],
]);

const alwaysInert = (keyword: string, value: SchemaValue | undefined) =>
  isAnnotationKeyword(keyword) ||
  rejectsNothing(keyword, value) ||
  INERT.get(keyword)?.(value) === true;

type Counted = 'properties' | 'items';

/** What a schema's own `unevaluated` keywords read. */
const countedIn = (node: SchemaNode): ReadonlySet<Counted> =>
  new Set([
    ...(anySchema(node.unevaluatedProperties) ? [] : (['properties'] as const)),
    ...(anySchema(node.unevaluatedItems) ? [] : (['items'] as const)),
  ]);

/** The fields and items a schema names. */
interface Named {
  properties: ReadonlySet<string>;
  patterns: ReadonlySet<string>;
  everyProperty: boolean;
  /** How many items, from the first. */
  items: number;
}

const NOTHING: Named = {
  properties: new Set(),
  patterns: new Set(),
  everyProperty: false,
  items: 0,
};

const EVERYTHING: Named = { ...NOTHING, everyProperty: true, items: Infinity };

const together = (all: Array<Named>): Named => ({
  properties: new Set(all.flatMap(({ properties }) => [...properties])),
  patterns: new Set(all.flatMap(({ patterns }) => [...patterns])),
  everyProperty: all.some(({ everyProperty }) => everyProperty),
  items: Math.max(0, ...all.map(({ items }) => items)),
});

interface Naming {
  root: SchemaNode;
  /** Only what it names for every value it accepts, rather than for any. */
  certain: boolean;
  /** Leaves out the branches a `$ref` target's own keyword of this kind does not read. */
  apart?: Counted;
}

/** The names a map of schemas gives; those it rejects outright are only named for certain. */
const namesOf = (schemas: SchemaNode['patternProperties'], certain: boolean) =>
  new Set(
    Object.entries(schemas ?? {}).flatMap(([name, schema]) =>
      certain || schema !== false ? [name] : [],
    ),
  );

/** What a schema's own keywords name: what it rejects outright is only named for certain. */
function namedHere(node: SchemaNode, certain: boolean): Named {
  const rest = (keywords: Array<string>) =>
    keywords.some((keyword) => node[keyword] !== undefined && (certain || node[keyword] !== false));

  return {
    properties: namesOf(node.properties, certain),
    patterns: namesOf(node.patternProperties, certain),
    everyProperty: rest(['additionalProperties', 'unevaluatedProperties']),
    items: rest(['items', 'unevaluatedItems', ...(certain ? [] : ['additionalItems', 'contains'])])
      ? Infinity
      : (node.prefixItems?.length ?? 0),
  };
}

/** The schemas in a schema that apply to the same value, some only for some values. */
const maybeInPlace = (node: SchemaNode): Array<SchemaNode | boolean | undefined> => [
  ...(node.anyOf ?? []),
  ...(node.oneOf ?? []),
  node.if,
  node.then,
  node.else,
  ...Object.values(node.dependentSchemas ?? {}),
];

function namedIn(schema: SchemaNode, naming: Naming, depth = 0): Named {
  const node = resolve(naming.root, schema);
  const { certain, apart, ...rest } = naming;

  // What cannot be read names nothing for certain, and may name anything.
  if (!certain && (depth > MAX_DEPTH || node.$ref !== undefined)) {
    return EVERYTHING;
  }

  if (depth > MAX_DEPTH) {
    return NOTHING;
  }

  const always = (node.allOf ?? []).filter(
    (branch) => apart === undefined || !readApart(branch).has(apart),
  );

  const branches = certain ? always : [...always, ...maybeInPlace(node)];

  return together([
    namedHere(node, certain),
    ...branches.flatMap((branch) =>
      isSchemaNode(branch) ? [namedIn(branch, { ...rest, certain }, depth + 1)] : [],
    ),
  ]);
}

function matches(pattern: string, name: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(name);
  } catch {
    return false;
  }
}

/** Whether everything of a kind in `some` is in `all` too. */
function coversNames(all: Named, some: Named, kind: Counted): boolean {
  if (kind === 'items') {
    return all.items >= some.items;
  }

  const named = (name: string) =>
    all.properties.has(name) || [...all.patterns].some((pattern) => matches(pattern, name));

  return (
    all.everyProperty ||
    (!some.everyProperty &&
      [...some.properties].every((name) => named(name)) &&
      [...some.patterns].every((pattern) => all.patterns.has(pattern)))
  );
}

/** An `unevaluated` keyword, and what the schema it is in names. */
interface Reader {
  kind: Counted;
  /** Whether it rejects whatever nothing names. */
  closed: boolean;
  /** What is named for every value the schema accepts. */
  certain: Named;
  /** What may be named for some. */
  possible: Named;
}

type Readers = ReadonlyArray<Reader>;

/** Whether a value the schema accepts can have the fields or items a reader reads. */
function holds(node: SchemaNode, kind: Counted): boolean {
  const values = node.const === undefined ? node.enum : [node.const];
  const types = typesOf(node);

  return kind === 'properties'
    ? types?.has('object') !== false && values?.some((value) => isSchemaNode(value)) !== false
    : types?.has('array') !== false && values?.some((value) => Array.isArray(value)) !== false;
}

/** The `unevaluated` keywords that read what a schema names: its own, and those around it for the same value. */
function readersOf(
  node: SchemaNode,
  around: Readers,
  { root, target }: { root: SchemaNode; target: SchemaNode | undefined },
): Readers {
  const { unevaluatedProperties, unevaluatedItems, ...named } = node;

  const naming = (kind: Counted, certain: boolean) =>
    together([
      namedIn(named, { root, apart: kind, certain }),
      ...(target ? [namedIn(target, { root, certain })] : []),
    ]);

  const own = [...countedIn(node)].map((kind): Reader => ({
    kind,
    closed: (kind === 'properties' ? unevaluatedProperties : unevaluatedItems) === false,
    certain: naming(kind, true),
    possible: naming(kind, false),
  }));

  return [...around, ...own].filter(({ kind }) => holds(node, kind));
}

/** Whether a reader rejected every value with a field or item some schema is about to name. */
interface Closed {
  property: (name: string) => boolean;
  /** Every field but those a schema exempts. */
  properties: (exempt?: SchemaNode) => boolean;
  /** Every item from a place on. */
  items: (from: number) => boolean;
}

function closedBy(readers: Readers): Closed {
  const closed = (kind: Counted) =>
    readers.flatMap((reader) => (reader.closed && reader.kind === kind ? [reader.possible] : []));

  return {
    property: (name) =>
      closed('properties').some(
        (named) => !coversNames(named, { ...NOTHING, properties: new Set([name]) }, 'properties'),
      ),
    properties: ({ properties, patternProperties } = {}) =>
      closed('properties').some((named) =>
        coversNames(
          namedHere(
            { ...(properties && { properties }), ...(patternProperties && { patternProperties }) },
            true,
          ),
          named,
          'properties',
        ),
      ),
    items: (from) => closed('items').some((named) => named.items <= from),
  };
}

interface Accepting {
  node: SchemaNode;
  closed: Closed;
  depth: number;
}

/** A schema's `additionalProperties` as the keyword a pattern beside it exempts fields from. */
function exemptedBy(node: SchemaNode): Readers {
  const { additionalProperties, properties, patternProperties } = node;

  const named = namedHere(
    { ...(properties && { properties }), ...(patternProperties && { patternProperties }) },
    true,
  );

  return anySchema(additionalProperties)
    ? []
    : [
        {
          kind: 'properties',
          closed: additionalProperties === false,
          certain: named,
          possible: named,
        },
      ];
}

/** Whether an `unevaluated` keyword governs a field when nothing names it. */
const governs = (readers: Readers, name: string) =>
  readers.some(
    ({ kind, certain }) =>
      kind === 'properties' &&
      !coversNames(certain, { ...NOTHING, properties: new Set([name]) }, kind),
  );

type Accepts = (value: SchemaValue | undefined, accepting: Accepting) => boolean;

const anyOr =
  (rejected: (accepting: Accepting) => boolean): Accepts =>
  (value, accepting) =>
    anySchema(value) || rejected(accepting);

const everyNamed =
  (rejected: (name: string, accepting: Accepting) => boolean): Accepts =>
  (value, accepting) =>
    isSchemaNode(value) &&
    Object.entries(value).every(([name, schema]) => anySchema(schema) || rejected(name, accepting));

const everyListed =
  (
    accepted: (schema: SchemaNode | boolean, index: number, accepting: Accepting) => boolean,
  ): Accepts =>
  (value, accepting) =>
    Array.isArray(value) &&
    value.every((item, index) => {
      const schema = asSchema(item);

      return schema !== undefined && accepted(schema, index, accepting);
    });

/** When each keyword rejects no value that was not already rejected. */
const ACCEPTS = new Map<string, Accepts>([
  ['properties', everyNamed((name, { closed }) => closed.property(name))],
  ['patternProperties', everyNamed((_, { closed }) => closed.properties())],
  ['additionalProperties', anyOr(({ node, closed }) => closed.properties(node))],
  ['unevaluatedProperties', anyOr(({ closed }) => closed.properties())],
  ['items', anyOr(({ node, closed }) => closed.items(node.prefixItems?.length ?? 0))],
  ['unevaluatedItems', anyOr(({ closed }) => closed.items(0))],
  ['additionalItems', anyOr(({ closed }) => closed.items(0))],
  [
    'prefixItems',
    everyListed((schema, index, { closed }) => anySchema(schema) || closed.items(index)),
  ],
  ['then', anyOr(() => false)],
  ['else', anyOr(() => false)],
  ['allOf', everyListed((schema, _, { closed, depth }) => acceptsAll(schema, closed, depth + 1))],
]);

/** Whether a schema rejects no value that was not already rejected. */
function acceptsAll(schema: SchemaNode | boolean, closed: Closed, depth = 0): boolean {
  if (isBooleanSchema(schema) || depth > MAX_DEPTH) {
    return schema === true;
  }

  return Object.entries(schema).every(
    ([keyword, value]) =>
      alwaysInert(keyword, value) ||
      ACCEPTS.get(keyword)?.(value, { node: schema, closed, depth }) === true,
  );
}

const OPEN = closedBy([]);

/** Whether a schema's `unevaluated` keyword always finds nothing, by the rest of it and the target it was beside. */
function isIdle(node: SchemaNode, root: SchemaNode, kind: Counted): boolean {
  const { unevaluatedProperties: _properties, unevaluatedItems: _items, ...rest } = node;
  const target = besideTarget.get(node);

  const named = together([
    namedIn(rest, { root, apart: kind, certain: true }),
    ...(target ? [namedIn(target, { root, certain: true })] : []),
  ]);

  return kind === 'properties' ? named.everyProperty : named.items === Infinity;
}

const UNEVALUATED = [
  ['properties', 'unevaluatedProperties'],
  ['items', 'unevaluatedItems'],
] as const;

function without(node: SchemaNode, keywords: Array<string>): SchemaNode {
  const kept: SchemaNode = Object.fromEntries(
    Object.entries(node).filter(([keyword]) => !keywords.includes(keyword)),
  );

  const target = besideTarget.get(node);

  if (target) {
    besideTarget.set(kept, target);
  }

  return kept;
}

/**
 * Schemas without the `unevaluated` keywords that are idle in each that has one.
 * Idle in one alone, it stays in both: what it starts or stops reading is the change.
 */
function settled(sides: Array<{ node: SchemaNode; root: SchemaNode }>): Array<SchemaNode> {
  const idle = UNEVALUATED.flatMap(([kind, keyword]) => {
    const having = sides.filter(({ node }) => node[keyword] !== undefined);

    return having.length > 0 && having.every(({ node, root }) => isIdle(node, root, kind))
      ? [keyword]
      : [];
  });

  return sides.map(({ node }) => (idle.length > 0 ? without(node, idle) : node));
}

/** The keywords whose schemas apply to the same value as the schema they are in. */
const IN_PLACE = new Set(['if', 'then', 'else', 'dependentSchemas']);

type Direction = 'tightened' | 'loosened' | 'changed';

/** A schema only one side has. */
interface OneSided {
  side: 'added' | 'removed';
  schema: SchemaNode;
  root: SchemaNode;
  /** The `unevaluated` keywords of the side without it. */
  readers: Readers;
}

/** Whether a schema names something the side without it leaves unevaluated. */
function evaluates({ schema, root, readers }: OneSided): boolean {
  if (readers.length === 0) {
    return false;
  }

  const named = namedIn(schema, { root, certain: false });

  return readers.some(({ kind, certain }) => !coversNames(certain, named, kind));
}

/**
 * Which way a schema only one side has moves: what it rejects, against what it
 * lets an `unevaluated` keyword pass. Undefined when no payload can tell.
 */
function oneSidedDirection(only: OneSided): Direction | undefined {
  const passes = evaluates(only);
  const rejects = !acceptsAll(only.schema, closedBy(only.readers));

  if (passes && rejects) {
    return 'changed';
  }

  if (!passes && !rejects) {
    return undefined;
  }

  return passes === (only.side === 'added') ? 'loosened' : 'tightened';
}

const combined = (directions: Array<Direction | undefined>): Direction | undefined => {
  const [direction, ...others] = new Set(directions.filter((one) => one !== undefined));

  return others.length > 0 ? 'changed' : direction;
};

const numbers =
  (pick: (a: number, b: number) => number | undefined) => (a: SchemaValue, b: SchemaValue) => {
    const pair = numberPair.safeParse([a, b]);

    return pair.success ? pick(...pair.data) : undefined;
  };

const typePair = z.array(z.union([z.string(), z.array(z.string())]));

/** The types both admit, or undefined when neither's cover the other's. */
function bothTypes(a: SchemaValue, b: SchemaValue): SchemaValue | undefined {
  const types = typePair.safeParse([a, b]);

  if (!types.success) {
    return undefined;
  }

  const [first, second] = types.data.map((type) => new Set([type].flat()));

  if (coversTypes(second, first)) {
    return a;
  }

  return coversTypes(first, second) ? b : undefined;
}

/** The values in both enums, or undefined when there are none. */
function bothEnums(a: SchemaValue, b: SchemaValue): SchemaValue | undefined {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return undefined;
  }

  const values = a.filter((value) => b.some((other) => sameValue(value, other)));

  return values.length > 0 ? values : undefined;
}

const bothLists = (a: SchemaValue, b: SchemaValue): SchemaValue | undefined =>
  Array.isArray(a) && Array.isArray(b) ? [...new Set([...a, ...b])] : undefined;

/** The keywords that say one thing on their own, and how two of each say it together. */
const COMBINED = new Map<string, (a: SchemaValue, b: SchemaValue) => SchemaValue | undefined>([
  ...NUMERIC_TIGHTENS_UP.map((keyword) => [keyword, numbers(Math.max)] as const),
  ...NUMERIC_TIGHTENS_DOWN.map((keyword) => [keyword, numbers(Math.min)] as const),
  ['multipleOf', numbers((a, b) => [a, b].find((one) => one % a === 0 && one % b === 0))],
  ['uniqueItems', (a, b) => a === true || b === true],
  ['required', bothLists],
  ['type', bothTypes],
  ['enum', bothEnums],
  ['format', () => undefined],
  ['pattern', () => undefined],
  ['const', () => undefined],
  // Reads what the target names too, so it is the target's when that has none.
  ['unevaluatedProperties', () => undefined],
  ['unevaluatedItems', () => undefined],
]);

/** A keyword's one value that says what a target's and a sibling's say together, if it has one. */
function bothApply(
  keyword: string,
  target: SchemaValue | undefined,
  sibling: SchemaValue | undefined,
): SchemaValue | undefined {
  const combine = COMBINED.get(keyword);

  if (!combine || sibling === undefined) {
    return undefined;
  }

  if (target === undefined || sameValue(target, sibling)) {
    return sibling;
  }

  return combine(target, sibling);
}

/**
 * The target each branch from beside a `$ref` was beside. The branch's own
 * `unevaluated` keywords read what the target names; the target's do not read it.
 */
const besideTarget = new WeakMap<SchemaNode, SchemaNode>();

const readApart = (branch: SchemaNode): ReadonlySet<Counted> =>
  countedIn(besideTarget.get(branch) ?? {});

/** Whether a schema is a `$ref` and nothing else that constrains. */
const onlyRefers = (node: SchemaNode) =>
  Object.keys(node).every((keyword) => keyword === '$ref' || isAnnotationKeyword(keyword));

/** Two schemas as one, where either may be a reference, read later. */
function bothNodes(a: SchemaNode, b: SchemaNode, depth: number): SchemaNode {
  const refers = [a, b].filter((node) => node.$ref !== undefined);

  if (refers.length === 0 && depth <= MAX_DEPTH) {
    return merged(a, b, depth);
  }

  // What is beside a reference applies with its target.
  const [only] = refers;

  return only && refers.length === 1 && onlyRefers(only) ? { ...a, ...b } : { allOf: [a, b] };
}

/** One schema that says what both do for a field. */
function bothSchemas(
  a: SchemaNode | boolean,
  b: SchemaNode | boolean,
  depth: number,
): SchemaNode | boolean {
  if (isBooleanSchema(a)) {
    return a && b;
  }

  if (isBooleanSchema(b)) {
    return b && a;
  }

  return sameValue(a, b) ? a : bothNodes(a, b, depth);
}

/**
 * The fields of a target and of what is beside it, as one schema's; undefined
 * where a keyword about the rest reads only one side's.
 */
function bothProperties(
  target: SchemaNode,
  siblings: SchemaNode,
  depth: number,
): SchemaNode['properties'] {
  const rest = [
    target.additionalProperties,
    siblings.additionalProperties,
    target.unevaluatedProperties,
  ];

  if (!rest.every((schema) => anySchema(schema))) {
    return undefined;
  }

  const { properties = {} } = target;

  return {
    ...properties,
    ...Object.fromEntries(
      Object.entries(siblings.properties ?? {}).map(([name, schema]) => {
        const own = Object.hasOwn(properties, name) ? properties[name] : undefined;

        return [name, own === undefined ? schema : bothSchemas(own, schema, depth + 1)];
      }),
    ),
  };
}

/** A target, and the keywords beside a reference to it, as one schema. */
function merged(target: SchemaNode, siblings: SchemaNode, depth = 0): SchemaNode {
  const together = new Map<string, SchemaValue | undefined>();
  const beside: Array<[string, SchemaValue | undefined]> = [];

  for (const [keyword, value] of Object.entries(siblings)) {
    const both =
      keyword === 'properties'
        ? bothProperties(target, siblings, depth)
        : bothApply(keyword, target[keyword], value);

    if (isAnnotationKeyword(keyword)) {
      together.set(keyword, value);
    } else if (both !== undefined) {
      together.set(keyword, both);
    } else if (!alwaysInert(keyword, value)) {
      beside.push([keyword, value]);
    }
  }

  // What both say as one keyword is said once, so it lines up with a side that has
  // no siblings, or the same schema written inline. Anything else, such as what
  // applies to the rest of the fields, becomes a branch that applies beside the
  // target: last, so the target's own branches keep their places.
  if (beside.length === 0) {
    return { ...target, ...Object.fromEntries(together) };
  }

  const branch: SchemaNode = Object.fromEntries(beside);

  besideTarget.set(branch, target);

  return {
    ...target,
    ...Object.fromEntries(together),
    allOf: [...(target.allOf ?? []), branch],
  };
}

const listed = (value: SchemaValue | undefined) => (Array.isArray(value) ? value : undefined);

/** Draft 2019-09 and earlier write a tuple as a list of `items`, and the rest as `additionalItems`. */
function asTuple(node: SchemaNode): SchemaNode {
  const items = listed(node.items);

  if (!items) {
    return node;
  }

  const { items: _items, additionalItems, ...rest } = node;

  return {
    ...rest,
    prefixItems: items.map((item) => asSchema(item) ?? true),
    ...(additionalItems !== undefined && { items: additionalItems }),
  };
}

function resolve(root: SchemaNode, node: SchemaNode, seen = new Set<string>()): SchemaNode {
  const ref = node.$ref;
  // A cycle resolves to the node as written rather than hanging; MAX_DEPTH
  // bounds the walk that follows.
  const target = ref === undefined || seen.has(ref) ? undefined : pointer(root, ref);

  if (ref === undefined || target === undefined) {
    return asTuple(node);
  }

  const { $ref: _ref, ...siblings } = node;

  // Resolved one hop at a time so siblings survive at *every* level: for
  // `value → A → B` where A carries its own `minimum`, following the chain
  // straight to B drops A's constraint and the tightening disappears.
  return merged(resolve(root, target, new Set([...seen, ref])), siblings);
}

interface BranchPair {
  before: SchemaNode;
  after: SchemaNode;
  /** The place of `after` among its side's branches. */
  index: number;
}

interface BranchMatch {
  pairs: Array<BranchPair>;
  /** The branches only one side has. */
  only: { before: Array<SchemaNode>; after: Array<SchemaNode> };
}

/**
 * Which branches to compare. Position is the only correspondence a schema gives,
 * so a reordered union reports as changed branches. Every `allOf` branch applies wherever it is, so one
 * written the same on both sides is the same one.
 */
function branchPairs(
  keyword: 'anyOf' | 'oneOf' | 'allOf',
  before: Array<SchemaNode>,
  after: Array<SchemaNode>,
): BranchMatch {
  const open = after.map((branch, index) => ({ branch, index }));
  const pairs: Array<BranchPair> = [];
  const rest: Array<SchemaNode> = [];

  for (const branch of before) {
    const at =
      keyword === 'allOf' ? open.findIndex((other) => sameValue(other.branch, branch)) : -1;

    const [same] = at === -1 ? [] : open.splice(at, 1);

    if (same) {
      pairs.push({ before: branch, after: same.branch, index: same.index });
    } else {
      rest.push(branch);
    }
  }

  for (const [n, { branch, index }] of open.entries()) {
    const left = rest[n];

    // A branch may be `false`.
    if (left !== undefined) {
      pairs.push({ before: left, after: branch, index });
    }
  }

  return {
    pairs,
    only: {
      before: rest.slice(open.length),
      after: open.slice(rest.length).map(({ branch }) => branch),
    },
  };
}

function walkPair(
  previous: SchemaNode,
  current: SchemaNode,
  path: string,
  depth: number,
  results: Array<DiffResult>,
  roots: WalkRoots,
): void {
  if (depth > MAX_DEPTH) {
    return;
  }

  const targets = { previous: besideTarget.get(previous), current: besideTarget.get(current) };

  const before = resolve(roots.previous, previous);
  const after = resolve(roots.current, current);

  [previous = before, current = after] = settled([
    { node: before, root: roots.previous },
    { node: after, root: roots.current },
  ]);

  const here: WalkRoots = {
    ...roots,
    readers: {
      previous: readersOf(previous, roots.readers.previous, {
        root: roots.previous,
        target: targets.previous,
      }),
      current: readersOf(current, roots.readers.current, {
        root: roots.current,
        target: targets.current,
      }),
    },
  };

  const inside: WalkRoots = { ...roots, readers: { previous: [], current: [] } };

  const readersFor = (side: 'previous' | 'current', branch: SchemaNode): Readers => {
    const apart = readApart(branch);

    return here.readers[side].filter(
      (reader) => !apart.has(reader.kind) || roots.readers[side].includes(reader),
    );
  };

  /** A schema only the current side has, read by what the previous side leaves unevaluated. */
  const added = (schema: SchemaNode): OneSided => ({
    side: 'added',
    schema,
    root: roots.current,
    readers: readersFor('previous', schema),
  });

  const removed = (schema: SchemaNode): OneSided => ({
    side: 'removed',
    schema,
    root: roots.previous,
    readers: readersFor('current', schema),
  });

  const closedBefore = closedBy(here.readers.previous);
  const closedAfter = closedBy(here.readers.current);

  compareNode(previous, current, path || '(root)', results);

  // Once the shape diverges, everything underneath reports as removed and
  // buries the one finding that mattered. A widened or narrowed type keeps
  // the shape it shared, so `object → [object, null]` still walks its fields.
  if (typeDirection(previous, current) === 'changed') {
    return;
  }

  /** Two schemas for what is inside this value, either of which may be a boolean. */
  const walkEither = (
    before: SchemaNode | boolean,
    after: SchemaNode | boolean,
    childPath: string,
  ) => {
    // Nothing is inside `false` to compare; the type carries the whole change.
    if (before === false || after === false) {
      const type = typeChange(before, after, childPath);

      if (type) {
        results.push(type);
      }

      return;
    }

    const [was, is] = [before === true ? {} : before, after === true ? {} : after];

    walkPair(was, is, childPath, depth + 1, results, inside);
  };

  const prevProps = previous.properties ?? {};
  const currProps = current.properties ?? {};
  const prevReq = new Set(previous.required ?? []);
  const currReq = new Set(current.required ?? []);
  const at = (key: string): string => (path ? `${path}.${key}` : key);

  for (const key of new Set([...Object.keys(prevProps), ...Object.keys(currProps)])) {
    // `properties: { blocked: false }` is a property that rejects every value.
    // Testing truthiness reads it as absent and the whole change disappears.
    const hadKey = Object.hasOwn(prevProps, key);
    const hasKey = Object.hasOwn(currProps, key);
    const prev = prevProps[key];
    const curr = currProps[key];
    const childPath = at(key);

    // A removed object is one finding, not one per field underneath it. The
    // parent is what the consumer lost; the children are detail.
    if (hadKey && !hasKey) {
      results.push({
        kind: 'removed',
        path: childPath,
        detail: typeLabel(prev),
        wasRequired: prevReq.has(key),
        ...((current.additionalProperties === false || closedAfter.property(key)) && {
          containerClosedAfter: true,
        }),
        ...(governs(here.readers.current, key) && { containerGovernedAfter: true }),
      });
      // The name is unnamed now but not unconstrained: whatever the new object
      // applies to unknown properties is what this field must satisfy.
      const inherited = effectiveUnknown(current);

      if (inherited !== undefined && isSchemaNode(prev)) {
        walkPair(prev, inherited, childPath, depth + 1, results, inside);
      }

      continue;
    }

    if (!hadKey && hasKey) {
      results.push({
        kind: 'added',
        path: childPath,
        detail: typeLabel(curr),
        isRequired: currReq.has(key),
        // `additionalProperties: {type: "string"}` already constrained this
        // name; naming it explicitly as anything lets through values the old
        // schema rejected. Naming it as another schema is compared below.
        ...((previous.additionalProperties === false ||
          (restrictsUnknownProperties(previous) && !isSchemaNode(curr)) ||
          governs(here.readers.previous, key)) && {
          containerClosedBefore: true,
        }),
        // A property schema of `false` accepts nothing, so adding it rejects
        // every payload carrying the field — the opposite of additive.
        ...(curr === false && { propertyForbidden: true }),
        // The field was unconstrained before and is typed now, so payloads that
        // carried any other shape of it stop validating. "Optional" says the
        // field may be absent; it says nothing about what it may contain.
        ...(previous.additionalProperties !== false &&
          !closedBefore.property(key) &&
          constrainsValues(curr) && { constrainsPreviouslyFree: true }),
      });
      // Naming a field the old object only covered through
      // `additionalProperties` is a comparison, not an appearance from nothing:
      // the two schemas both applied to this name and may disagree.
      const inherited = effectiveUnknown(previous);

      if (inherited !== undefined && isSchemaNode(curr)) {
        walkPair(inherited, curr, childPath, depth + 1, results, inside);
      }

      continue;
    }

    if (prev !== undefined && curr !== undefined) {
      walkEither(prev, curr, childPath);
    }
  }

  // Required transitions at this level
  for (const key of new Set([...prevReq, ...currReq])) {
    const wasReq = prevReq.has(key);
    const isReq = currReq.has(key);

    // `required: ["id"]` constrains payloads whether or not `properties.id`
    // exists, so the requirement is reported on its own. The one case to skip
    // is a property removed outright: that is already one finding, and
    // repeating it as "no longer required" only adds noise.
    if (!isReq && Object.hasOwn(prevProps, key) && !Object.hasOwn(currProps, key)) {
      continue;
    }

    if (!wasReq && isReq) {
      results.push({ kind: 'required_added', path: at(key), detail: 'now required' });
    }

    if (wasReq && !isReq) {
      results.push({ kind: 'required_removed', path: at(key), detail: 'now optional' });
    }
  }

  // Array elements, including the case where only one side constrains them.
  // Presence is tested against `undefined`, never truthiness: `items: false`
  // rejects every non-empty array and would otherwise read as no items at all.
  const elementPath = `${path || ''}[]`;
  const prevItems = previous.items;
  const currItems = current.items;

  const itemsConstraint = (
    previousLabel: string | undefined,
    currentLabel: string | undefined,
    direction: Direction | undefined,
  ) => {
    if (direction === undefined) {
      return;
    }

    results.push({
      kind: 'constraint_changed',
      path: elementPath,
      detail: `items ${previousLabel ?? '∅'} → ${currentLabel ?? '∅'}`,
      constraint: { keyword: 'items', previous: previousLabel, current: currentLabel, direction },
    });
  };

  if (prevItems !== undefined && currItems !== undefined) {
    walkEither(prevItems, currItems, elementPath);
  } else if (prevItems === undefined && currItems !== undefined) {
    const { prefixItems } = current;

    const only = added({
      ...(prefixItems && { prefixItems: prefixItems.map(() => ({})) }),
      items: currItems,
    });

    itemsConstraint(undefined, typeLabel(currItems), oneSidedDirection(only));
  } else if (prevItems !== undefined && currItems === undefined) {
    const { prefixItems } = previous;

    const only = removed({
      ...(prefixItems && { prefixItems: prefixItems.map(() => ({})) }),
      items: prevItems,
    });

    itemsConstraint(typeLabel(prevItems), undefined, oneSidedDirection(only));
  }

  // What each side applies to properties it does not name. Walking it here is
  // what makes a `$ref` inside `additionalProperties` visible at all.
  const prevUnknown = effectiveUnknown(previous);
  const currUnknown = effectiveUnknown(current);

  if (prevUnknown !== undefined && currUnknown !== undefined) {
    walkPair(prevUnknown, currUnknown, `${path || ''}.*`, depth + 1, results, inside);
  } else if (prevUnknown === undefined || currUnknown === undefined) {
    const before = previous.additionalProperties;
    const after = current.additionalProperties;

    const unknownDirection = (): Direction | undefined => {
      if (sameValue(before, after)) {
        return undefined;
      }

      if (before === undefined) {
        return oneSidedDirection(added(unknownIn(current)));
      }

      if (after === undefined) {
        return oneSidedDirection(removed(unknownIn(previous)));
      }

      if (!restrictsUnknownProperties(current)) {
        return 'loosened';
      }

      return restrictsUnknownProperties(previous) ? 'changed' : 'tightened';
    };

    const direction = unknownDirection();

    if (direction !== undefined) {
      results.push({
        kind: 'constraint_changed',
        path: `${path || '(root)'}.*`,
        detail: `additionalProperties ${typeLabel(before)} → ${typeLabel(after)}`,
        constraint: {
          keyword: 'additionalProperties',
          previous: typeLabel(before),
          current: typeLabel(after),
          direction,
        },
      });
    }
  }

  // Every other place a schema can hide. Presence changes report a direction;
  // when both sides have one, the pair is walked so a changed `$ref` target is
  // seen even though the reference text is identical.
  const nested = (
    keyword: string,
    before: SchemaValue | undefined,
    after: SchemaValue | undefined,
    place: {
      path: string;
      wrap: (schema: SchemaValue) => SchemaNode;
      /** What else the keyword names fields for, on each side. */
      exempts?: { previous: Readers; current: Readers };
    },
  ): void => {
    const childPath = place.path;

    if (before === undefined && after === undefined) {
      return;
    }

    // `not` inverts: a wider forbidden set accepts less. `if` decides which of
    // `then`/`else` applies, so widening the predicate can send values into a
    // stricter branch. Neither can pass a child's classification through as it
    // stands — an "additive" enum widening under either is a restriction.
    const inverts = keyword === 'not';
    const scope = IN_PLACE.has(keyword) ? here : inside;

    // A predicate that cannot change which payloads are accepted has nothing
    // under it worth reporting either — walking it would surface an enum
    // widening that changes nothing.
    if (keyword === 'if' && !predicateCanMatter(previous, current)) {
      return;
    }

    const cannotInherit = inverts || keyword === 'if';

    if (before === undefined || after === undefined) {
      const gained = before === undefined;
      const only = gained ? added(place.wrap(after ?? true)) : removed(place.wrap(before));
      const exempts = place.exempts?.[gained ? 'previous' : 'current'] ?? [];
      const direction = oneSidedDirection({ ...only, readers: [...only.readers, ...exempts] });

      if (direction === undefined) {
        return;
      }

      results.push({
        kind: 'constraint_changed',
        path: childPath,
        detail: `${keyword} ${gained ? '∅ → present' : 'present → ∅'}`,
        constraint: {
          keyword,
          previous: gained ? undefined : keyword,
          current: gained ? keyword : undefined,
          // Most of these containers restrict when present: `not` forbids what
          // it matches, `contains` demands an element, a conditional adds a
          // branch of validation.
          direction,
        },
      });

      return;
    }

    // A boolean is a schema: `false` accepts nothing, `true` accepts anything,
    // and an object sits between them. Comparing against the literals `true`
    // and `false` alone gets every transition through an object backwards.
    if (isBooleanSchema(before) || isBooleanSchema(after)) {
      const [was, is] = [permissiveness(before, inverts), permissiveness(after, inverts)];

      if (was === is || (anySchema(before) && anySchema(after))) {
        return;
      }

      const named =
        is < was ? evaluates(added(place.wrap(after))) : evaluates(removed(place.wrap(before)));

      results.push({
        kind: 'constraint_changed',
        path: childPath,
        detail: `${keyword} ${typeLabel(asSchema(before))} → ${typeLabel(asSchema(after))}`,
        constraint: {
          keyword,
          previous: typeLabel(asSchema(before)),
          current: typeLabel(asSchema(after)),
          // A predicate decides which branch applies, whichever way it moves.
          direction: named || keyword === 'if' ? 'changed' : is < was ? 'tightened' : 'loosened',
        },
      });

      return;
    }

    if (!isSchemaNode(before) || !isSchemaNode(after)) {
      return;
    }

    if (!cannotInherit) {
      walkPair(before, after, childPath, depth + 1, results, scope);

      return;
    }

    // Under `not` the child findings describe the forbidden set, and under `if`
    // they describe which branch applies rather than what is accepted.
    // Reporting them as they stand would state the opposite of what happened,
    // so they are replaced by one finding that cannot be cleared automatically.
    const negated: Array<DiffResult> = [];
    walkPair(before, after, childPath, depth + 1, negated, scope);
    const changesValidation = negated.filter((finding) => !isAnnotation(finding));

    if (changesValidation.length > 0) {
      results.push({
        kind: 'constraint_changed',
        path: childPath,
        detail: `${inverts ? 'what is forbidden' : 'which branch applies'} changed (${changesValidation
          .map((finding) => finding.detail)
          .join('; ')})`,
        constraint: { keyword, previous: undefined, current: undefined, direction: 'changed' },
      });
    }
  };

  for (const keyword of SCHEMA_KEYWORDS) {
    nested(keyword, previous[keyword], current[keyword], {
      path: `${path || ''}.${keyword}`,
      wrap: (schema) => ({ [keyword]: schema }),
    });
  }

  // `items` governs every place `prefixItems` does not, so each place is compared
  // by whichever governs it.
  const places = Math.max(previous.prefixItems?.length ?? 0, current.prefixItems?.length ?? 0);

  for (let index = 0; index < places; index += 1) {
    const before = previous.prefixItems?.[index] ?? prevItems;
    const after = current.prefixItems?.[index] ?? currItems;

    nested('prefixItems', before, after, {
      path: `${path || ''}.prefixItems[${index}]`,
      wrap: (schema) => ({
        prefixItems: [...Array.from({ length: index }, () => true), asSchema(schema) ?? true],
      }),
    });
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const before = previous[keyword];
    const after = current[keyword];

    if (before === undefined && after === undefined) {
      continue;
    }

    for (const name of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
      nested(keyword, before?.[name], after?.[name], {
        path: `${path || ''}.${keyword}[${name}]`,
        wrap: (schema) => ({ [keyword]: { [name]: schema } }),
        ...(keyword === 'patternProperties' && {
          exempts: { previous: exemptedBy(previous), current: exemptedBy(current) },
        }),
      });
    }
  }

  // Unions and intersections. A branch changing from number to boolean rejects
  // payloads that were accepted, and no amount of property walking sees it.
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const prevBranches = previous[keyword];
    const currBranches = current[keyword];

    if (!Array.isArray(prevBranches) && !Array.isArray(currBranches)) {
      continue;
    }

    // A branch that rejects nothing matters only to an `unevaluated` keyword.
    const matters = (branch: SchemaNode) =>
      keyword !== 'allOf' ||
      readersFor('previous', branch).length > 0 ||
      readersFor('current', branch).length > 0 ||
      !acceptsAll(branch, OPEN);

    const before = (prevBranches ?? []).filter((branch) => matters(branch));
    const after = (currBranches ?? []).filter((branch) => matters(branch));
    const existedBefore = keyword === 'allOf' ? before.length > 0 : Array.isArray(prevBranches);
    const existsNow = keyword === 'allOf' ? after.length > 0 : Array.isArray(currBranches);
    const { pairs, only } = branchPairs(keyword, before, after);

    const direction =
      keyword === 'allOf'
        ? combined([
            ...only.after
              .flatMap((node) => settled([{ node, root: roots.current }]))
              .map((branch) => oneSidedDirection(added(branch))),
            ...only.before
              .flatMap((node) => settled([{ node, root: roots.previous }]))
              .map((branch) => oneSidedDirection(removed(branch))),
          ])
        : unionDirection(keyword, {
            existedBefore,
            existsNow,
            before: before.length,
            after: after.length,
            gained: oneSidedDirection(added({ [keyword]: after })) ?? 'tightened',
            lost: oneSidedDirection(removed({ [keyword]: before })) ?? 'loosened',
          });

    if (
      direction !== undefined &&
      (existedBefore !== existsNow || before.length !== after.length)
    ) {
      results.push({
        kind: 'constraint_changed',
        path: `${path || '(root)'}|${keyword}`,
        detail: existedBefore
          ? existsNow
            ? `${keyword} ${before.length} → ${after.length} branches`
            : `${keyword} ${before.length} branches → ∅`
          : `${keyword} ∅ → ${after.length} branches`,
        constraint: {
          keyword,
          previous: existedBefore ? before.length : undefined,
          current: existsNow ? after.length : undefined,
          direction,
        },
      });
    }

    const branchResults: Array<DiffResult> = [];

    for (const pair of pairs) {
      const childPath = `${path || ''}|${keyword}[${pair.index}]`;

      const scope = {
        ...roots,
        readers: {
          previous: readersFor('previous', pair.before),
          current: readersFor('current', pair.after),
        },
      };

      walkPair(pair.before, pair.after, childPath, depth + 1, branchResults, scope);
    }

    results.push(...branchResults);

    // `oneOf` demands exactly one match, so widening a branch can make a value
    // match two and become invalid — an edit that reads as additive in
    // isolation. Any change inside a `oneOf` is therefore unprovable on its
    // own, whatever the branch findings say.
    // Annotation-only edits change nothing a validator sees, so they must not
    // trip the conservative rule — a reworded description failing CI teaches
    // people to ignore the gate.
    const branchChangesValidation = branchResults.some((finding) => !isAnnotation(finding));

    if (keyword === 'oneOf' && branchChangesValidation) {
      results.push({
        kind: 'constraint_changed',
        path: `${path || '(root)'}|oneOf`,
        detail: `a oneOf branch changed (${branchResults.length} change${branchResults.length === 1 ? '' : 's'}) — a value may now match a different number of branches`,
        constraint: {
          keyword: 'oneOf',
          previous: before.length,
          current: after.length,
          direction: 'changed',
        },
      });
    }
  }
}

/**
 * Compare two JSON Schemas, walking nested objects and array items so a change
 * to `payment.amount` is as visible as a change to a top-level field. Paths are
 * dotted, with `[]` marking an array element (`items[].sku`).
 */
export function diffSchemas(previous: SchemaNode, current: SchemaNode): Array<DiffResult> {
  const results: Array<DiffResult> = [];
  // The payload root is a node like any other, and `walkPair` treats it that
  // way: one recursion covers properties, array elements, union branches, the
  // node itself, and whatever a local `$ref` points at.
  walkPair(previous, current, '', 0, results, {
    previous,
    current,
    readers: { previous: [], current: [] },
  });

  results.sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);

    return ka !== kb ? ka - kb : a.path.localeCompare(b.path);
  });

  return results;
}
