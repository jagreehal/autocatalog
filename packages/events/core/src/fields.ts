import { z } from 'zod';
import { typeLabel } from './diff';
import { isJsonObject, jsonValueSchema, type JsonObject, type JsonValue } from './json';
import { derefLocal } from './json-ref';
import type { LoadedEvent } from './load';

export interface FieldOccurrence {
  domain: string;
  eventId: string;
  version: string;
  /** JSON Schema type of this field in this event. */
  type: string;
  required: boolean;
  /** Declared only in some `oneOf`/`anyOf` branches: present for some payload shapes, not others. */
  conditional: boolean;
  consumers: string[];
  producers: string[];
}

export interface FieldSummary {
  /** Dotted path; array element paths carry a `[]` segment (`items[].sku`). */
  path: string;
  /** Last path segment — what people actually search for. */
  name: string;
  occurrences: FieldOccurrence[];
  /** Distinct types this field carries across events. */
  types: string[];
  requiredIn: number;
  /** Every service consuming an event that carries this field — the blast radius. */
  consumers: string[];
  producers: string[];
  /** The same field means different things in different events. */
  typeConflict: boolean;
  /** Guaranteed in some events, optional in others — consumers cannot assume it. */
  requiredConflict: boolean;
}

// Only the keywords `typeLabel` reads; a malformed keyword reads as absent.
const labelKeywords = z.object({
  type: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined),
  enum: z.array(jsonValueSchema).optional().catch(undefined),
});

function fieldType(child: JsonValue): string {
  // JSON Schema allows `true`/`false` where a schema is expected.
  if (child === true || child === false) return typeLabel(child);

  return isJsonObject(child) ? typeLabel(labelKeywords.parse(child)) : 'unknown';
}

interface Entry {
  child: JsonValue;
  required: boolean;
  conditional: boolean;
  /** Taken from one `oneOf`/`anyOf` branch, so `child` may not be how the others declare it. */
  branched?: boolean;
  /** Other definitions that apply as well, from `allOf` parts beside this one. */
  also?: JsonValue[];
}

type Entries = Map<string, Entry>;

/** Both maps always apply (`properties` beside `allOf`): either one guarantees a field. */
function merge(into: Entries, from: Entries): void {
  for (const [path, entry] of from) {
    const seen = into.get(path);

    if (!seen) {
      into.set(path, entry);
      continue;
    }

    // Only a definition that always applies binds the field: one from an
    // `anyOf`/`oneOf` branch holds only when that branch is the one taken.
    const always = !seen.branched ? seen : !entry.branched ? entry : undefined;

    const also =
      !seen.branched && !entry.branched
        ? [...(seen.also ?? []), entry.child, ...(entry.also ?? [])]
        : always?.also;

    into.set(path, {
      child: (always ?? seen).child,
      required: seen.required || entry.required,
      conditional: seen.conditional && entry.conditional,
      ...(!always && { branched: true }),
      ...(also && { also }),
    });
  }
}

/**
 * Exactly one (or some) of these maps applies. A field every branch declares is
 * as good as unconditional; one only some branches declare is not, and neither
 * is a guarantee only some branches make.
 */
function either(branches: Entries[]): Entries {
  const out: Entries = new Map();

  for (const path of new Set(branches.flatMap((b) => [...b.keys()]))) {
    const found = branches.map((b) => b.get(path));
    const inAll = found.every((e) => e !== undefined);
    out.set(path, {
      child: found.find((e) => e !== undefined)!.child,
      required: inAll && found.every((e) => e?.required),
      conditional: !inAll || found.some((e) => e?.conditional),
      branched: true,
    });
  }

  return out;
}

// An external, circular or dangling pointer reads as the node as written.
function deref(root: JsonObject, node: JsonValue): JsonValue {
  try {
    return derefLocal<JsonValue>(root, node);
  } catch {
    return node;
  }
}

const refKeyword = z.object({ $ref: z.string() });

function collect(
  root: JsonObject,
  value: JsonValue,
  prefix: string,
  refs: ReadonlySet<string>,
): Entries {
  const out: Entries = new Map();

  if (!isJsonObject(value)) return out;

  // A pointer already followed on this branch is recursion; stop there.
  const pointer = refKeyword.safeParse(value);

  if (pointer.success) {
    const ref = pointer.data.$ref;

    if (refs.has(ref)) return out;

    return collect(root, deref(root, value), prefix, new Set([...refs, ref]));
  }

  for (const [key, raw] of Object.entries(isJsonObject(value.properties) ? value.properties : {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = deref(root, raw);
    merge(out, new Map([[path, { child, required: false, conditional: false }]]));
    merge(out, collect(root, raw, path, refs));

    // Arrays hide their contract one level down; `items[].sku` is the honest path.
    if (isJsonObject(child) && child.items !== undefined) {
      merge(out, collect(root, child.items, `${path}[]`, refs));
    }
  }

  for (const branch of Array.isArray(value.allOf) ? value.allOf : []) {
    merge(out, collect(root, branch, prefix, refs));
  }

  // Zod discriminated unions declare every field inside the branches.
  for (const branches of [value.oneOf, value.anyOf]) {
    if (Array.isArray(branches)) {
      merge(out, either(branches.map((b) => collect(root, b, prefix, refs))));
    }
  }

  // `required` binds a key wherever it is declared: here or in a branch.
  for (const key of Array.isArray(value.required) ? value.required : []) {
    const path = prefix ? `${prefix}.${String(key)}` : String(key);
    const entry = out.get(path);

    if (entry) out.set(path, { ...entry, required: true });
  }

  return out;
}

const unique = (values: string[]): string[] => [...new Set(values)].sort();

/**
 * Project every scanned schema into a field-level index: one entry per field
 * path, listing the events that carry it and the services downstream of them.
 *
 * Consumers are inferred from the events a service already consumes. A consumer
 * may declare the fields it reads (`consumerFields`), and drift narrows on that,
 * but most will not — a declared field list is the maintained-catalog problem
 * this whole tool exists to avoid. So "who reads `payment.amount`" is answered
 * here as "who receives an event that carries it", which is an over-estimate of
 * the blast radius rather than a confident wrong answer.
 */
export function indexFields(events: LoadedEvent[]): FieldSummary[] {
  const byPath = new Map<string, FieldOccurrence[]>();

  for (const event of events) {
    for (const [path, { child, required, conditional }] of collect(
      event.schema,
      event.schema,
      '',
      new Set(),
    )) {
      byPath.set(path, [
        ...(byPath.get(path) ?? []),
        {
          domain: event.frontmatter.domain,
          eventId: event.frontmatter.id,
          version: event.frontmatter.version,
          type: fieldType(child),
          required,
          conditional,
          consumers: event.frontmatter.consumers,
          producers: event.frontmatter.producers,
        },
      ]);
    }
  }

  return [...byPath.entries()]
    .map(([path, occurrences]) => {
      const types = unique(occurrences.map((o) => o.type));
      const requiredIn = occurrences.filter((o) => o.required).length;

      return {
        path,
        name: path.split('.').at(-1)!.replace('[]', ''),
        occurrences,
        types,
        requiredIn,
        consumers: unique(occurrences.flatMap((o) => o.consumers)),
        producers: unique(occurrences.flatMap((o) => o.producers)),
        typeConflict: types.length > 1,
        requiredConflict: requiredIn > 0 && requiredIn < occurrences.length,
      };
    })
    .sort((a, b) => b.occurrences.length - a.occurrences.length || a.path.localeCompare(b.path));
}

/** Every field path one schema declares, named exactly as the field index names it. */
export function fieldPaths(schema: JsonObject): Set<string> {
  return new Set(collect(schema, schema, '', new Set()).keys());
}

/** The field paths a schema marks `deprecated: true`: the fields on their way out. */
export function deprecatedFields(schema: JsonObject): string[] {
  return [...collect(schema, schema, '', new Set())].flatMap(([path, { child }]) =>
    isJsonObject(child) && child.deprecated === true ? [path] : [],
  );
}

/** What a schema lets one field hold: its JSON types, and the values an enum or const allows. */
export interface FieldConstraint {
  types?: string[];
  values?: JsonValue[];
  format?: string;
}

const constraintKeywords = z.object({
  type: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined),
  nullable: z.boolean().optional().catch(undefined),
  enum: z.array(jsonValueSchema).optional().catch(undefined),
  const: jsonValueSchema.optional().catch(undefined),
  format: z.string().optional().catch(undefined),
});

/**
 * The type and value constraints a schema puts on each field path, for checking
 * what a running service actually sent. A field declared with neither is left
 * out: anything is allowed there.
 */
export function fieldConstraints(schema: JsonObject): Map<string, FieldConstraint> {
  const out = new Map<string, FieldConstraint>();

  for (const [path, { child, branched, also = [] }] of collect(schema, schema, '', new Set())) {
    if (branched) continue;

    // Every `allOf` part applies, so a value must pass them all.
    const constraint = [child, ...also]
      .flatMap((definition) => (isJsonObject(definition) ? [constraintOf(definition)] : []))
      .reduce<FieldConstraint>(
        (all, one) => ({
          ...((all.types || one.types) && { types: bothTypes(all.types, one.types) }),
          ...((all.values || one.values) && { values: intersect(all.values, one.values) }),
          ...((all.format ?? one.format) && { format: all.format ?? one.format }),
        }),
        {},
      );

    if (constraint.types || constraint.values) out.set(path, constraint);
  }

  return out;
}

/** What one definition of a field allows. */
function constraintOf(definition: JsonObject): FieldConstraint {
  const {
    type,
    nullable,
    enum: values,
    const: only,
    format,
  } = constraintKeywords.parse(definition);

  const types = type === undefined ? [] : [type].flat();

  // OpenAPI 3.0 writes "may be null" as `nullable`, not as a type.
  if (types.length > 0 && nullable) types.push('null');

  return {
    ...(types.length > 0 && { types }),
    ...(values && { values }),
    ...(only !== undefined && { values: [only] }),
    ...(format && { format }),
  };
}

/** The types both definitions allow: `integer` is a `number`, so the two meet at `integer`. */
function bothTypes(a: string[] | undefined, b: string[] | undefined): string[] {
  if (!a || !b) return a ?? b ?? [];

  const within = (type: string, of: string[]) =>
    of.includes(type) || (type === 'integer' && of.includes('number'));

  return [...new Set([...a.filter((t) => within(t, b)), ...b.filter((t) => within(t, a))])];
}

/** What both lists allow, where an absent list allows anything. */
function intersect<T extends JsonValue>(a: T[] | undefined, b: T[] | undefined): T[] {
  if (!a) return b ?? [];

  if (!b) return a;

  const keep = new Set(b.map((value) => JSON.stringify(value)));

  return a.filter((value) => keep.has(JSON.stringify(value)));
}

const isObjectType = (type: JsonValue | undefined) =>
  type === 'object' || (Array.isArray(type) && type.every((t) => t === 'object'));

const objectArray = (value: JsonValue | undefined): JsonValue[] =>
  Array.isArray(value) ? value : [];

/**
 * The field paths every valid payload carries, under `prefix`. A parent passes
 * its required fields down only when it is always an object: `properties` alone
 * admits null, as does `type: ['object', 'null']` or `nullable`. Every `allOf`
 * part applies, so they combine; only one `anyOf`/`oneOf` branch does, so a
 * field counts only when every branch guarantees it.
 */
function guaranteedUnder(
  root: JsonObject,
  raw: JsonValue,
  prefix: string,
  inherited: { object: boolean; properties: JsonObject; required: string[] },
  refs: ReadonlySet<string>,
): Set<string> {
  const pointer = refKeyword.safeParse(raw);

  if (pointer.success && refs.has(pointer.data.$ref)) return new Set();

  const seen = pointer.success ? new Set([...refs, pointer.data.$ref]) : refs;
  const value = deref(root, raw);

  if (!isJsonObject(value)) return new Set();

  // This schema and every allOf part beneath it, all of which apply at once.
  const parts: JsonObject[] = [];

  const flatten = (part: JsonValue) => {
    const resolved = deref(root, part);

    if (!isJsonObject(resolved)) return;

    parts.push(resolved);
    objectArray(resolved.allOf).forEach(flatten);
  };

  flatten(value);

  const object =
    inherited.object || parts.some((part) => isObjectType(part.type) && part.nullable !== true);

  // A property declared in several places must satisfy all of them, so they combine as allOf.
  const properties: JsonObject = { ...inherited.properties };

  for (const part of parts)
    for (const [key, schema] of Object.entries(
      isJsonObject(part.properties) ? part.properties : {},
    ))
      properties[key] = Object.hasOwn(properties, key)
        ? { allOf: [properties[key]!, schema] }
        : schema;

  const required = [
    ...new Set([
      ...inherited.required,
      ...parts.flatMap((part) => objectArray(part.required).map(String)),
    ]),
  ];

  const out = new Set<string>();

  if (object)
    for (const key of required) {
      // A required key is present even when nothing declares what it holds.
      const path = prefix ? `${prefix}.${key}` : key;

      out.add(path);

      for (const child of guaranteedUnder(
        root,
        properties[key] ?? {},
        path,
        { object: false, properties: {}, required: [] },
        seen,
      ))
        out.add(child);
    }

  for (const branches of parts.flatMap((part) => [part.anyOf, part.oneOf])) {
    const sets = objectArray(branches).map((branch) =>
      guaranteedUnder(root, branch, prefix, { object, properties, required }, seen),
    );

    for (const path of sets[0] ?? []) if (sets.every((set) => set.has(path))) out.add(path);
  }

  return out;
}

/**
 * The field paths every valid payload carries. Nothing inside an array is, since
 * it can be empty, and nothing at all when the payload itself may be null.
 */
export function guaranteedFieldPaths(schema: JsonObject): Set<string> {
  return guaranteedUnder(
    schema,
    schema,
    '',
    { object: false, properties: {}, required: [] },
    new Set(),
  );
}

/** Fields whose path or final segment contains `query`, case-insensitively. */
export function searchFields(summaries: FieldSummary[], query: string): FieldSummary[] {
  const needle = query.toLowerCase();

  return summaries.filter(
    (f) => f.path.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle),
  );
}

/** The field disagrees with itself across events, on type or on requiredness. */
export function hasFieldConflict(field: FieldSummary): boolean {
  return field.typeConflict || field.requiredConflict;
}

/**
 * Plain-language summary of what disagrees. Null when the field is consistent.
 * Shared so the CLI, the site and MCP describe a conflict the same way.
 */
export function describeFieldConflict(field: FieldSummary): string | null {
  const notes: string[] = [];

  if (field.typeConflict) notes.push(`types differ: ${field.types.join(' | ')}`);

  if (field.requiredConflict) {
    notes.push(`required in ${field.requiredIn}/${field.occurrences.length}`);
  }

  return notes.length > 0 ? notes.join('; ') : null;
}

/** One query path for every surface: search first, then narrow to conflicts. */
export function queryFields(
  summaries: FieldSummary[],
  opts: { query?: string; conflictsOnly?: boolean } = {},
): FieldSummary[] {
  const matched = opts.query ? searchFields(summaries, opts.query) : summaries;

  return opts.conflictsOnly ? matched.filter(hasFieldConflict) : matched;
}
