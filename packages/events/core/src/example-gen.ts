import { z } from 'zod';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { derefLocal } from './json-ref';

/**
 * The scalar keywords the generator reads. A keyword of the wrong type is
 * ignored, as if absent — the schema is someone else's, and a bad `minLength`
 * should not stop an example from being generated.
 */
const scalarKeywords = z.object({
  format: z.string().optional().catch(undefined),
  minimum: z.number().optional().catch(undefined),
  exclusiveMinimum: z.number().optional().catch(undefined),
  minLength: z.number().optional().catch(undefined),
  maxLength: z.number().optional().catch(undefined),
});

// Zod writes the safe-integer range onto every int. That is no real bound, and
// an example of -9007199254740991 teaches a reader nothing about the field.
const UNBOUNDED = -Number.MAX_SAFE_INTEGER;

function numericSample(schema: JsonObject): number {
  const { minimum, exclusiveMinimum } = scalarKeywords.parse(schema);

  if (minimum !== undefined && minimum > UNBOUNDED) return minimum;

  if (exclusiveMinimum !== undefined && exclusiveMinimum > UNBOUNDED) {
    return exclusiveMinimum + 1;
  }

  return 0;
}

const FORMAT_SAMPLES = new Map([
  ['date-time', '2026-01-01T12:00:00Z'],
  ['date', '2026-01-01'],
  ['time', '12:00:00Z'],
  ['email', 'user@example.com'],
  ['uri', 'https://example.com'],
  ['url', 'https://example.com'],
  ['uuid', '00000000-0000-4000-8000-000000000000'],
  ['hostname', 'example.com'],
  ['ipv4', '192.0.2.1'],
]);

/** Enough for any real contract, and a bound on references that fan out. */
const MAX_NODES = 10_000;

/** Deep enough for any real contract, and a bound on the stack: linked definitions recurse. */
const MAX_DEPTH = 64;

const reference = z.object({ $ref: z.string().optional().catch(undefined) });

interface Walk {
  /** The document local references point into. */
  root: JsonObject;
  /** References followed to reach this node, so a cycle stops. */
  following: string[];
  nodes: { left: number };
  depth: number;
}

/** What a reference points at, or undefined when it cannot or should not be followed. */
function followRef(ref: string, walk: Walk): JsonValue | undefined {
  if (walk.following.includes(ref)) return undefined;

  if (ref === '#') return walk.root;

  try {
    return derefLocal(walk.root, { $ref: ref });
  } catch {
    return undefined;
  }
}

function sample(schema: JsonObject, walk: Walk): JsonValue {
  if ((walk.nodes.left -= 1) < 0 || walk.depth > MAX_DEPTH) return null;

  const { $ref: ref } = reference.parse(schema);

  if (ref !== undefined) {
    return sampleSubschema(followRef(ref, walk) ?? false, {
      ...walk,
      following: [...walk.following, ref],
    });
  }

  if (schema.const !== undefined) return schema.const;

  if (schema.default !== undefined) return schema.default;

  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]!;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]!;

  // `.nullable()` writes the real type first, so the first branch is the useful
  // one. Beside a type of its own, a branch only narrows it.
  const [branch] = [schema.anyOf, schema.oneOf].find(Array.isArray) ?? [];

  if (branch !== undefined && schema.type === undefined && schema.properties === undefined) {
    return sampleSubschema(branch, walk);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'object': {
      const props = isJsonObject(schema.properties) ? schema.properties : {};

      // include every property so the example shows the full shape,
      // but never omit a required one
      return Object.fromEntries(
        Object.entries(props).map(([key, prop]) => [key, sampleSubschema(prop, walk)]),
      );
    }

    case 'array': {
      const item = schema.items ? sampleSubschema(schema.items, walk) : 'sample';

      return [item];
    }

    case 'string': {
      const {
        format,
        minLength: min = 0,
        maxLength: max = Infinity,
      } = scalarKeywords.parse(schema);

      const sampled = format ? FORMAT_SAMPLES.get(format) : undefined;

      if (sampled) return sampled;
      const target = Math.min(Math.max('string'.length, min), max);

      return 'string'.repeat(Math.ceil(target / 6)).slice(0, target) || 's'.repeat(min || 1);
    }

    case 'integer':
      return numericSample(schema);
    case 'number':
      return numericSample(schema);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      // no type: prefer object-ish if properties exist
      if (schema.properties) return sample({ ...schema, type: 'object' }, walk);

      return null;
  }
}

/** A boolean (or otherwise non-object) subschema constrains nothing we can sample. */
function sampleSubschema(schema: JsonValue, walk: Walk): JsonValue {
  return isJsonObject(schema) ? sample(schema, { ...walk, depth: walk.depth + 1 }) : null;
}

/**
 * Deterministically generate a baseline example payload from a JSON Schema.
 * Not random and not clever — the point is that a generated example exists,
 * validates, and is obviously a placeholder until a real one replaces it.
 */
export function generateExampleFromSchema(schema: JsonObject): JsonValue {
  return sample(schema, { root: schema, following: [], nodes: { left: MAX_NODES }, depth: 0 });
}
