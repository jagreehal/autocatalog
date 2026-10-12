import { z } from 'zod';

/** A value `JSON.parse` (or a YAML/Avro/proto-JSON loader) can produce. */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/** Deep parser for untrusted JSON-shaped input. Use once, at the I/O boundary. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

// Shallow: the value is already a JsonValue, so only the top level needs checking.
const plainObject = z.looseObject({});

/** Narrow an already-parsed JSON value to an object (not an array, not null). */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return plainObject.safeParse(value).success;
}
