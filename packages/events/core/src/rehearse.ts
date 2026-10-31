import type { ErrorObject, ValidateFunction } from 'ajv';
import type { DiffResult } from './diff';
import { generateExampleFromSchema } from './example-gen';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { jsonSchemaAjv, jsonSchemaDialect } from './json-schema-dialect';

/**
 * A payload the proposed schema accepts and the current one rejects: the
 * worked example behind a breaking finding. Only ever a payload that was
 * validated both ways, so a reader can paste it into a consumer's test.
 */
export interface Rehearsal {
  payload: JsonValue;
  /** The check the current schema fails, such as `/amount must be number` or `/amount is required`. */
  failure: string;
}

/** Delete `path` (`amount`, `items[].sku`) wherever it occurs in `value`, in place. */
function remove(value: JsonValue | undefined, path: string[]): void {
  const [head, ...rest] = path;

  if (head === undefined || !isJsonObject(value)) return;
  const many = head.endsWith('[]');
  const key = many ? head.slice(0, -2) : head;

  if (rest.length === 0 && !many) {
    delete value[key];

    return;
  }

  const child = value[key];

  for (const target of many && Array.isArray(child) ? child : [child]) remove(target, rest);
}

/** The payload without the field at `path`, on a copy. */
function without(payload: JsonValue, path: string): JsonValue {
  const copy = structuredClone(payload);
  remove(copy, path.split('.').filter(Boolean));

  return copy;
}

/** Where an error points, including the property it says is missing or unexpected. */
function pointerOf(error: ErrorObject): string {
  // SAFETY: ajv's `required` and `additionalProperties` errors name the property here; other keywords leave both undefined.
  const params = error.params as { missingProperty?: string; additionalProperty?: string };
  const property = params.missingProperty ?? params.additionalProperty;

  return property === undefined ? error.instancePath : `${error.instancePath}/${property}`;
}

/** `items[].sku` → matches `/items/0/sku` and anything below it. */
function pointerPattern(path: string): RegExp {
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const segments = path
    .split('.')
    .filter(Boolean)
    .map((segment) =>
      segment.endsWith('[]') ? `/${escape(segment.slice(0, -2))}/\\d+` : `/${escape(segment)}`,
    );

  return new RegExp(`^${segments.join('')}(/|$)`);
}

const parts = (pointer: string) => pointer.split('/').slice(1);

function valueAt(value: JsonValue | undefined, pointer: string): JsonValue | undefined {
  let here = value;

  for (const part of parts(pointer)) {
    if (Array.isArray(here)) here = here[Number(part)];
    else if (isJsonObject(here)) here = here[part];
    else return undefined;
  }

  return here;
}

function setAt(value: JsonValue, pointer: string, next: JsonValue): boolean {
  const path = parts(pointer);
  const last = path.pop();
  const parent = valueAt(value, path.length > 0 ? `/${path.join('/')}` : '');

  if (last === undefined || !isJsonObject(parent)) return false;
  parent[last] = next;

  return true;
}

function describeFailure(error: ErrorObject): string {
  // SAFETY: ajv's `required` errors name the property here; other keywords leave it undefined.
  const missing = (error.params as { missingProperty?: string }).missingProperty;

  return missing
    ? `${error.instancePath}/${missing} is required`
    : `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`;
}

/** Rounds of repair before a payload counts as not isolating the change. */
const REPAIRS = 5;

/**
 * Looks for a payload a change lets through that the current schema refuses
 * because of that change and nothing else: the proposed schema's own example,
 * then that example with the changed field taken out. Where the payload also
 * breaks the current schema somewhere else (another change in the same
 * diff), those places take the current schema's own example values, so the
 * rehearsal shows one change, not whichever failed first. Finds nothing when
 * no payload isolates the change, since a guess is not evidence. Undefined
 * when ajv cannot compile either schema.
 */
export function rehearser(
  previous: JsonObject,
  proposed: JsonObject,
): ((diff: DiffResult, renamedFrom?: string) => Rehearsal | undefined) | undefined {
  const compile = (schema: JsonObject) => jsonSchemaAjv(jsonSchemaDialect(schema)).compile(schema);
  let accepts: ValidateFunction;
  let current: ValidateFunction;

  try {
    accepts = compile(proposed);
    current = compile(previous);
  } catch {
    return undefined;
  }

  const base = generateExampleFromSchema(proposed);
  const previousExample = generateExampleFromSchema(previous);

  const isolate = (candidate: JsonValue, changed: RegExp): Rehearsal | undefined => {
    const payload = structuredClone(candidate);

    for (let round = 0; round < REPAIRS; round++) {
      if (!accepts(payload) || current(payload)) return undefined;
      const errors = current.errors ?? [];
      const elsewhere = errors.filter((error) => !changed.test(pointerOf(error)));

      if (elsewhere.length === 0) return { payload, failure: describeFailure(errors[0]!) };

      // Borrow what the current schema expects there, from its own example.
      const repaired = elsewhere.filter((error) => {
        const pointer = pointerOf(error);
        const wanted = valueAt(previousExample, pointer.replace(/\/\d+(?=\/|$)/g, '/0'));

        return wanted !== undefined && setAt(payload, pointer, structuredClone(wanted));
      });

      if (repaired.length === 0) return undefined;
    }

    return undefined;
  };

  return (diff, renamedFrom) => {
    const path = renamedFrom ?? diff.path;
    const changed = pointerPattern(path);

    for (const candidate of [base, without(base, path)]) {
      const rehearsal = isolate(candidate, changed);

      if (rehearsal) return rehearsal;
    }

    return undefined;
  };
}
