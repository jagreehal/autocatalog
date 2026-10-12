import { z } from 'zod';
import { isJsonObject, type JsonObject, type JsonValue } from './json';

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

/**
 * Deterministically generate a baseline example payload from a JSON Schema.
 * Not random and not clever — the point is that a generated example exists,
 * validates, and is obviously a placeholder until a real one replaces it.
 */
export function generateExampleFromSchema(schema: JsonObject, depth = 0): JsonValue {
  if (depth > 6) return null;

  if (schema.const !== undefined) return schema.const;

  if (schema.default !== undefined) return schema.default;

  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]!;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]!;

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'object': {
      const props = isJsonObject(schema.properties) ? schema.properties : {};

      // include every property so the example shows the full shape,
      // but never omit a required one
      return Object.fromEntries(
        Object.entries(props).map(([key, prop]) => [key, exampleFromSubschema(prop, depth + 1)]),
      );
    }

    case 'array': {
      const item = schema.items ? exampleFromSubschema(schema.items, depth + 1) : 'sample';

      return [item];
    }

    case 'string': {
      const {
        format,
        minLength: min = 0,
        maxLength: max = Infinity,
      } = scalarKeywords.parse(schema);

      const sample = format ? FORMAT_SAMPLES.get(format) : undefined;

      if (sample) return sample;
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
      if (schema.properties) return generateExampleFromSchema({ ...schema, type: 'object' }, depth);

      return null;
  }
}

/** A boolean (or otherwise non-object) subschema constrains nothing we can sample. */
function exampleFromSubschema(schema: JsonValue, depth: number): JsonValue {
  return isJsonObject(schema) ? generateExampleFromSchema(schema, depth) : null;
}
