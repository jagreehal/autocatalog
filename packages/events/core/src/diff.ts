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
  enumAdded?: unknown[];
  enumRemoved?: unknown[];
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
  /** Which keyword moved, and whether it admits fewer values than before. */
  constraint?: {
    keyword: string;
    previous?: unknown;
    current?: unknown;
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
export type SchemaValue = JsonPrimitive | SchemaNode | SchemaValue[];

/**
 * A JSON Schema object. The keywords the comparison reads are typed; any other
 * keyword is still reachable, because an unmodelled keyword is still enforced.
 */
export interface SchemaNode {
  [keyword: string]: SchemaValue | undefined;
  type?: string | string[];
  // `properties: { blocked: false }` is legal: an entry can be a boolean schema.
  properties?: Record<string, SchemaNode | boolean>;
  items?: SchemaNode | boolean;
  required?: string[];
  description?: string;
  enum?: SchemaValue[];
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
  prefixItems?: SchemaNode[];
  patternProperties?: Record<string, SchemaNode | boolean>;
  dependentSchemas?: Record<string, SchemaNode | boolean>;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
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
const isSchemaNode = (value: SchemaValue | undefined): value is SchemaNode =>
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

const KIND_ORDER: DiffKind[] = [
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
  if (s === true) return 'any';

  if (s === false) return 'never';

  if (!s) return 'unknown';

  if (Array.isArray(s.type)) return s.type.join(' | ');

  if (s.type !== undefined) return s.type;

  if (s.enum) return 'enum';

  return 'unknown';
}

/** The JSON types a schema admits, or `undefined` when it admits any type. */
function typesOf(s: SchemaNode | boolean | undefined): Set<string> | undefined {
  if (s === false) return new Set();

  if (s === true || s?.type === undefined) return undefined;

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

  if (widens && narrows) return undefined;

  return widens ? 'widened' : narrows ? 'narrowed' : 'changed';
}

/** A type finding, or `null` when the admitted types are the same set. */
function typeChange(
  previous: SchemaNode | boolean | undefined,
  current: SchemaNode | boolean | undefined,
  path: string,
): DiffResult | null {
  const direction = typeDirection(previous, current);

  if (direction === undefined) return null;

  return {
    kind: 'type_changed',
    path,
    detail: `${typeLabel(previous)} → ${typeLabel(current)}`,
    typeDirection: direction,
  };
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));
}

interface EnumDiff {
  detail: string;
  added: unknown[];
  removed: unknown[];
  introduced: boolean;
  dropped: boolean;
}

const show = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join(', ');

function diffEnums(prev: unknown[] | undefined, next: unknown[] | undefined): EnumDiff | null {
  if (!prev && !next) return null;

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
    if (arraysEqual(prev, next)) return null;
    const added = next.filter((v) => !prev.some((p) => JSON.stringify(p) === JSON.stringify(v)));
    const removed = prev.filter((v) => !next.some((n) => JSON.stringify(n) === JSON.stringify(v)));
    const parts: string[] = [];

    if (added.length) parts.push(`+${show(added)}`);

    if (removed.length) parts.push(`-${show(removed)}`);

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
  if (JSON.stringify(previous) === JSON.stringify(current)) return null;
  const base = { keyword, previous, current };

  // Adding a bound where there was none only ever removes freedom; dropping one
  // only ever adds it.
  if (previous === undefined) return { ...base, direction: 'tightened' };

  if (current === undefined) return { ...base, direction: 'loosened' };

  const tighter = tightens?.(previous, current);

  if (tighter !== undefined) return { ...base, direction: tighter ? 'tightened' : 'loosened' };

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
  results: DiffResult[],
): void {
  const type = typeChange(previous, current, path);

  if (type) results.push(type);

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

    if (before === now) continue;

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
    if (ANNOTATION_KEYWORDS.has(keyword) || UNDERSTOOD_KEYWORDS.has(keyword)) continue;

    if (CONSTRAINT_KEYWORDS.has(keyword)) continue;

    if (keyword.startsWith('x-')) continue;
    const before = previous[keyword];
    const after = current[keyword];

    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    results.push({
      kind: 'constraint_changed',
      path,
      detail: `${keyword} ${JSON.stringify(before ?? null)} → ${JSON.stringify(after ?? null)}`,
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
        detail: `${keyword} ${JSON.stringify(constraint.previous ?? null)} → ${JSON.stringify(constraint.current ?? null)}`,
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
  keyword: 'anyOf' | 'oneOf' | 'allOf',
  existedBefore: boolean,
  existsNow: boolean,
  before: number,
  after: number,
): 'tightened' | 'loosened' | 'changed' {
  if (!existedBefore && existsNow) return 'tightened';

  if (existedBefore && !existsNow) return 'loosened';

  if (keyword === 'oneOf') return 'changed';

  if (keyword === 'allOf') return after > before ? 'tightened' : 'loosened';

  return after > before ? 'loosened' : 'tightened';
}

interface WalkRoots {
  previous: SchemaNode;
  current: SchemaNode;
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
  if (depth > MAX_DEPTH) return undefined;

  if (isSchemaNode(node) && node.$anchor === name) return node;

  const children = Array.isArray(node) ? node : isSchemaNode(node) ? Object.values(node) : [];

  for (const value of children) {
    const found = anchorTarget(value, name, depth + 1);

    if (found) return found;
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

  if (additional === undefined || additional === true) return false;

  if (additional === false) return true;

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

    if (!constrainsValues(thenBranch) && !constrainsValues(elseBranch)) return true;

    return JSON.stringify(thenBranch ?? null) === JSON.stringify(elseBranch ?? null);
  };

  return !(branchesIrrelevant(previous) && branchesIrrelevant(current));
}

/**
 * How much a subschema lets through, as an order: `true` accepts anything, an
 * object accepts some of it, `false` accepts nothing. Under `not` the ends
 * swap, because `not: false` forbids nothing and `not: true` forbids everything.
 */
function permissiveness(node: SchemaValue, inverts: boolean): number {
  if (node === true) return inverts ? 0 : 2;

  if (node === false) return inverts ? 2 : 0;

  return 1;
}

/** The schema an object applies to properties it does not name, if any. */
function effectiveUnknown(node: SchemaNode): SchemaNode | undefined {
  const additional = node.additionalProperties;

  return isBooleanSchema(additional) ? undefined : additional;
}

/** Whether a schema restricts anything at all, as opposed to `true` or `{}`. */
function constrainsValues(node: SchemaNode | boolean | undefined): boolean {
  if (node === false) return true;

  if (node === true || node === undefined) return false;

  return Object.keys(node).some(
    (keyword) => !ANNOTATION_KEYWORDS.has(keyword) && !keyword.startsWith('x-'),
  );
}

function pointer(root: SchemaNode, ref: string): SchemaNode | undefined {
  // `#/a/b` is a JSON pointer; `#name` is a named anchor. Supporting only the
  // first leaves a valid reference silently uncompared.
  if (ref.startsWith('#/')) {
    const target = ref
      .slice(2)
      .split('/')
      .reduce<SchemaValue | undefined>((acc, seg) => {
        const token = seg.replace(/~1/g, '/').replace(/~0/g, '~');

        if (Array.isArray(acc)) return acc[Number(token)];

        return isSchemaNode(acc) ? acc[token] : undefined;
      }, root);

    return isSchemaNode(target) ? target : undefined;
  }

  if (ref.startsWith('#') && ref.length > 1) return anchorTarget(root, ref.slice(1));

  return undefined;
}

function resolve(root: SchemaNode, node: SchemaNode, seen = new Set<string>()): SchemaNode {
  const ref = node.$ref;

  if (ref === undefined) return node;

  // A cycle resolves to the node as written rather than hanging; MAX_DEPTH
  // bounds the walk that follows.
  if (seen.has(ref)) return node;
  const target = pointer(root, ref);

  if (target === undefined) return node;

  const { $ref: _ref, ...siblings } = node;
  // Resolved one hop at a time so siblings survive at *every* level: for
  // `value → A → B` where A carries its own `minimum`, following the chain
  // straight to B drops A's constraint and the tightening disappears.
  const resolved = resolve(root, target, new Set([...seen, ref]));

  if (Object.keys(siblings).length === 0) return resolved;

  return { allOf: [resolved, siblings] };
}

function walkPair(
  previous: SchemaNode,
  current: SchemaNode,
  path: string,
  depth: number,
  results: DiffResult[],
  roots: WalkRoots,
): void {
  if (depth > MAX_DEPTH) return;

  previous = resolve(roots.previous, previous);
  current = resolve(roots.current, current);

  compareNode(previous, current, path || '(root)', results);

  // Once the shape diverges, everything underneath reports as removed and
  // buries the one finding that mattered. A widened or narrowed type keeps
  // the shape it shared, so `object → [object, null]` still walks its fields.
  if (typeDirection(previous, current) === 'changed') return;

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
        ...(current.additionalProperties === false && { containerClosedAfter: true }),
      });
      // The name is unnamed now but not unconstrained: whatever the new object
      // applies to unknown properties is what this field must satisfy.
      const inherited = effectiveUnknown(current);

      if (inherited !== undefined && isSchemaNode(prev)) {
        walkPair(prev, inherited, childPath, depth + 1, results, roots);
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
        // name; naming it explicitly with a different type lets through values
        // the old schema rejected. Only `true` or absent leaves it free.
        ...(restrictsUnknownProperties(previous) && { containerClosedBefore: true }),
        // A property schema of `false` accepts nothing, so adding it rejects
        // every payload carrying the field — the opposite of additive.
        ...(curr === false && { propertyForbidden: true }),
        // The field was unconstrained before and is typed now, so payloads that
        // carried any other shape of it stop validating. "Optional" says the
        // field may be absent; it says nothing about what it may contain.
        ...(previous.additionalProperties !== false &&
          constrainsValues(curr) && { constrainsPreviouslyFree: true }),
      });
      // Naming a field the old object only covered through
      // `additionalProperties` is a comparison, not an appearance from nothing:
      // the two schemas both applied to this name and may disagree.
      const inherited = effectiveUnknown(previous);

      if (inherited !== undefined && isSchemaNode(curr)) {
        walkPair(inherited, curr, childPath, depth + 1, results, roots);
      }

      continue;
    }

    if (isBooleanSchema(prev) || isBooleanSchema(curr)) {
      const type = typeChange(prev, curr, childPath);

      if (type) results.push(type);

      continue;
    }

    if (!prev || !curr) continue;

    walkPair(prev, curr, childPath, depth + 1, results, roots);
  }

  // Required transitions at this level
  for (const key of new Set([...prevReq, ...currReq])) {
    const wasReq = prevReq.has(key);
    const isReq = currReq.has(key);

    // `required: ["id"]` constrains payloads whether or not `properties.id`
    // exists, so the requirement is reported on its own. The one case to skip
    // is a property removed outright: that is already one finding, and
    // repeating it as "no longer required" only adds noise.
    if (Object.hasOwn(prevProps, key) && !Object.hasOwn(currProps, key)) continue;

    if (!wasReq && isReq)
      results.push({ kind: 'required_added', path: at(key), detail: 'now required' });

    if (wasReq && !isReq)
      results.push({ kind: 'required_removed', path: at(key), detail: 'now optional' });
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
    direction: 'tightened' | 'loosened',
  ) => {
    results.push({
      kind: 'constraint_changed',
      path: elementPath,
      detail: `items ${previousLabel ?? '∅'} → ${currentLabel ?? '∅'}`,
      constraint: { keyword: 'items', previous: previousLabel, current: currentLabel, direction },
    });
  };

  if (prevItems !== undefined && currItems !== undefined) {
    if (isBooleanSchema(prevItems) || isBooleanSchema(currItems)) {
      // A boolean element schema has nothing to descend into; the type
      // carries the whole change.
      const type = typeChange(prevItems, currItems, elementPath);

      if (type) results.push(type);
    } else {
      walkPair(prevItems, currItems, elementPath, depth + 1, results, roots);
    }
  } else if (prevItems === undefined && currItems !== undefined) {
    itemsConstraint(undefined, typeLabel(currItems), 'tightened');
  } else if (prevItems !== undefined && currItems === undefined) {
    itemsConstraint(typeLabel(prevItems), undefined, 'loosened');
  }

  // What each side applies to properties it does not name. Walking it here is
  // what makes a `$ref` inside `additionalProperties` visible at all.
  const prevUnknown = effectiveUnknown(previous);
  const currUnknown = effectiveUnknown(current);

  if (prevUnknown !== undefined && currUnknown !== undefined) {
    walkPair(prevUnknown, currUnknown, `${path || ''}.*`, depth + 1, results, roots);
  } else if (prevUnknown === undefined || currUnknown === undefined) {
    const before = previous.additionalProperties;
    const after = current.additionalProperties;

    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      results.push({
        kind: 'constraint_changed',
        path: `${path || '(root)'}.*`,
        detail: `additionalProperties ${typeLabel(before)} → ${typeLabel(after)}`,
        constraint: {
          keyword: 'additionalProperties',
          previous: typeLabel(before),
          current: typeLabel(after),
          direction: restrictsUnknownProperties(current)
            ? restrictsUnknownProperties(previous)
              ? 'changed'
              : 'tightened'
            : 'loosened',
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
    childPath: string,
  ): void => {
    if (before === undefined && after === undefined) return;

    // `not` inverts: a wider forbidden set accepts less. `if` decides which of
    // `then`/`else` applies, so widening the predicate can send values into a
    // stricter branch. Neither can pass a child's classification through as it
    // stands — an "additive" enum widening under either is a restriction.
    const inverts = keyword === 'not';

    // A predicate that cannot change which payloads are accepted has nothing
    // under it worth reporting either — walking it would surface an enum
    // widening that changes nothing.
    if (keyword === 'if' && !predicateCanMatter(previous, current)) return;
    const cannotInherit = inverts || keyword === 'if';

    if (before === undefined || after === undefined) {
      const added = before === undefined;
      results.push({
        kind: 'constraint_changed',
        path: childPath,
        detail: `${keyword} ${added ? '∅ → present' : 'present → ∅'}`,
        constraint: {
          keyword,
          previous: added ? undefined : keyword,
          current: added ? keyword : undefined,
          // Every one of these containers restricts when present: `not` forbids
          // what it matches, `contains` demands an element, a conditional adds
          // a branch of validation.
          direction: added ? 'tightened' : 'loosened',
        },
      });

      return;
    }

    // A boolean is a schema: `false` accepts nothing, `true` accepts anything,
    // and an object sits between them. Comparing against the literals `true`
    // and `false` alone gets every transition through an object backwards.
    if (isBooleanSchema(before) || isBooleanSchema(after)) {
      if (permissiveness(before, inverts) === permissiveness(after, inverts)) return;
      results.push({
        kind: 'constraint_changed',
        path: childPath,
        detail: `${keyword} ${typeLabel(asSchema(before))} → ${typeLabel(asSchema(after))}`,
        constraint: {
          keyword,
          previous: typeLabel(asSchema(before)),
          current: typeLabel(asSchema(after)),
          direction:
            permissiveness(after, inverts) < permissiveness(before, inverts)
              ? 'tightened'
              : 'loosened',
        },
      });

      return;
    }

    if (!isSchemaNode(before) || !isSchemaNode(after)) return;

    if (!cannotInherit) {
      walkPair(before, after, childPath, depth + 1, results, roots);

      return;
    }

    // Under `not` the child findings describe the forbidden set, and under `if`
    // they describe which branch applies rather than what is accepted.
    // Reporting them as they stand would state the opposite of what happened,
    // so they are replaced by one finding that cannot be cleared automatically.
    const negated: DiffResult[] = [];
    walkPair(before, after, childPath, depth + 1, negated, roots);
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
    nested(keyword, previous[keyword], current[keyword], `${path || ''}.${keyword}`);
  }

  for (const keyword of SCHEMA_LIST_KEYWORDS) {
    const before = previous[keyword];
    const after = current[keyword];

    if (before === undefined && after === undefined) continue;

    if (before === undefined || after === undefined || before.length !== after.length) {
      nested(keyword, before, after, `${path || ''}.${keyword}`);

      if (before === undefined || after === undefined) continue;
    }

    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      walkPair(
        before[index]!,
        after[index]!,
        `${path || ''}.${keyword}[${index}]`,
        depth + 1,
        results,
        roots,
      );
    }
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const before = previous[keyword];
    const after = current[keyword];

    if (before === undefined && after === undefined) continue;

    for (const name of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
      nested(keyword, before?.[name], after?.[name], `${path || ''}.${keyword}[${name}]`);
    }
  }

  // Unions and intersections. A branch changing from number to boolean rejects
  // payloads that were accepted, and no amount of property walking sees it.
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const prevBranches = previous[keyword];
    const currBranches = current[keyword];

    if (!Array.isArray(prevBranches) && !Array.isArray(currBranches)) continue;

    const before = prevBranches ?? [];
    const after = currBranches ?? [];
    const existedBefore = Array.isArray(prevBranches);
    const existsNow = Array.isArray(currBranches);

    if (existedBefore !== existsNow || before.length !== after.length) {
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
          direction: unionDirection(keyword, existedBefore, existsNow, before.length, after.length),
        },
      });
    }

    // Positional pairing is the only correspondence a schema gives us; a
    // reordered union reports as changed branches, which is the honest answer
    // when nothing says which branch became which.
    const branchResults: DiffResult[] = [];

    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      walkPair(
        before[index]!,
        after[index]!,
        `${path || ''}|${keyword}[${index}]`,
        depth + 1,
        results === branchResults ? results : branchResults,
        roots,
      );
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
export function diffSchemas(previous: SchemaNode, current: SchemaNode): DiffResult[] {
  const results: DiffResult[] = [];
  // The payload root is a node like any other, and `walkPair` treats it that
  // way: one recursion covers properties, array elements, union branches, the
  // node itself, and whatever a local `$ref` points at.
  walkPair(previous, current, '', 0, results, { previous, current });

  results.sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);

    return ka !== kb ? ka - kb : a.path.localeCompare(b.path);
  });

  return results;
}
