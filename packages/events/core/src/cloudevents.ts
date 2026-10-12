import { z } from 'zod';
import { jsonSchemaAjv, jsonSchemaDialect } from './json-schema-dialect';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from './json';

export const cloudEventsEnvelope = z.object({
  type: z.literal('cloudevents'),
  mode: z.enum(['structured', 'binary']).default('structured'),
  specversion: z.literal('1.0').default('1.0'),
});

export type CloudEventsEnvelope = z.infer<typeof cloudEventsEnvelope>;

/**
 * Attribute names are lower-case letters and digits, which the spec requires.
 * Its 20-character limit is only a SHOULD, so a longer name is accepted.
 */
const ATTRIBUTE_NAME = /^[a-z0-9]+$/;

const contextSchema = z
  .object({
    specversion: z.literal('1.0'),
    id: z.string().min(1),
    source: z.string().min(1),
    type: z.string().min(1),
    subject: z.string().min(1).optional(),
    time: z.iso.datetime({ offset: true }).optional(),
    dataschema: z.string().url().optional(),
    datacontenttype: z.string().min(1).optional(),
  })
  .catchall(
    z.union([z.string(), z.number(), z.boolean(), z.null()], {
      error: 'extension values are strings, numbers or booleans',
    }),
  )
  .superRefine((context, ctx) => {
    // A source is a URI-reference, which permits paths such as /billing.
    if (/\s/.test(context.source))
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'not a URI-reference' });
  });

/** What is wrong with an envelope, naming the attribute and never quoting a value. */
interface EnvelopeProblem {
  attribute?: string;
  message: string;
}

const describeProblem = ({ attribute, message }: EnvelopeProblem) =>
  attribute ? `CloudEvents attribute \`${attribute}\` is invalid: ${message}` : message;

interface DecodedCloudEvent {
  mode: CloudEventsEnvelope['mode'];
  context: z.infer<typeof contextSchema>;
  payload: JsonValue | undefined;
}

function decode(
  input: JsonValue,
  headers: Record<string, string> | undefined,
  mode: CloudEventsEnvelope['mode'],
): DecodedCloudEvent | EnvelopeProblem[] {
  const context: JsonObject = {};
  let payload: JsonValue | undefined = input;

  if (mode === 'binary') {
    if (!headers)
      return [{ message: 'CloudEvents binary mode is declared, but no ce- headers were supplied' }];

    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();

      if (key === 'content-type') context.datacontenttype = value;

      if (!key.startsWith('ce-')) continue;

      // Values are percent-encoded outside printable ASCII, `"` and `%`.
      try {
        context[key.slice(3)] = decodeURIComponent(value);
      } catch {
        return [{ attribute: key.slice(3), message: 'not percent-encoded' }];
      }
    }
  } else {
    const event = jsonObjectSchema.safeParse(input);

    if (!event.success) return [{ message: 'A structured CloudEvent is a JSON object' }];
    const { data, data_base64, ...attributes } = event.data;

    if (data !== undefined && data_base64 !== undefined)
      return [{ attribute: 'data', message: 'data and data_base64 are mutually exclusive' }];
    Object.assign(context, attributes);
    payload = data;

    if (data_base64 !== undefined) {
      const encoded = z
        .string()
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
        .safeParse(data_base64);

      if (!encoded.success) return [{ attribute: 'data_base64', message: 'not base64' }];
      payload = encoded.data;

      if (String(context.datacontenttype ?? '').startsWith('application/json')) {
        try {
          payload = jsonValueSchema.parse(
            JSON.parse(Buffer.from(encoded.data, 'base64').toString('utf8')),
          );
        } catch {
          return [{ attribute: 'data_base64', message: 'not JSON' }];
        }
      }
    }
  }

  const parsed = contextSchema.safeParse(context);

  const problems: EnvelopeProblem[] = [
    ...Object.keys(context)
      .filter((name) => !ATTRIBUTE_NAME.test(name))
      .map((attribute) => ({
        attribute,
        message: 'attribute names are lower-case letters and digits',
      })),
    ...(parsed.error?.issues ?? []).map((issue) => ({
      attribute: String(issue.path[0] ?? ''),
      message: issue.message,
    })),
  ];

  if (!parsed.success || problems.length) return problems;

  return { mode, context: parsed.data, payload };
}

/**
 * Read a CloudEvent in the given mode: binary when headers carry the context,
 * otherwise structured. Throws naming the first invalid attribute.
 */
export function decodeCloudEvent(
  input: JsonValue,
  headers?: Record<string, string>,
  mode: CloudEventsEnvelope['mode'] = headers ? 'binary' : 'structured',
): DecodedCloudEvent {
  const decoded = decode(input, headers, mode);

  if (Array.isArray(decoded)) throw new Error(describeProblem(decoded[0]!));

  return decoded;
}

export interface CloudEventsFinding {
  code: 'cloudevents_envelope_invalid' | 'cloudevents_payload_invalid';
  path?: string;
  message: string;
}

/**
 * Validate a message as its contract declares it: `mode` is the envelope's
 * declared mode; without one, headers mean binary. Every invalid attribute is
 * reported, by name.
 */
export function validateCloudEvent(
  input: JsonValue,
  schema: JsonObject,
  headers?: Record<string, string>,
  mode: CloudEventsEnvelope['mode'] = headers ? 'binary' : 'structured',
): CloudEventsFinding[] {
  const decoded = decode(input, headers, mode);

  if (Array.isArray(decoded))
    return decoded.map((problem) => ({
      code: 'cloudevents_envelope_invalid',
      ...(problem.attribute && { path: problem.attribute }),
      message: describeProblem(problem),
    }));

  // In the dialect ac validate compiled the same schema in.
  const validate = jsonSchemaAjv(jsonSchemaDialect(schema)).compile(schema);

  if (validate(decoded.payload)) return [];

  return (validate.errors ?? []).map((error) => ({
    code: 'cloudevents_payload_invalid',
    path: error.instancePath,
    message: `CloudEvents payload violates ${error.keyword} at ${error.instancePath || '/'}`,
  }));
}

/**
 * A structured CloudEvent as JSON Schema: the context attributes the spec
 * requires and allows, with `data` the event's own schema. What a consumer
 * receives in structured mode, and so what AsyncAPI describes as the payload.
 */
export function cloudEventEnvelopeSchema(data: JsonValue): JsonObject {
  return {
    type: 'object',
    required: ['specversion', 'id', 'source', 'type'],
    properties: {
      specversion: { const: '1.0' },
      id: { type: 'string', minLength: 1 },
      source: { type: 'string', minLength: 1 },
      type: { type: 'string', minLength: 1 },
      subject: { type: 'string', minLength: 1 },
      time: { type: 'string', format: 'date-time' },
      dataschema: { type: 'string', format: 'uri' },
      datacontenttype: { type: 'string', minLength: 1 },
      data,
    },
    // Extension attributes are strings, numbers, booleans or null.
    additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
  };
}
