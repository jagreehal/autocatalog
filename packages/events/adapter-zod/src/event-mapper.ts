import {
  jsonObjectSchema,
  jsonValueSchema,
  pascalCase,
  type JsonObject,
  type JsonValue,
  type AdapterEvent,
  type ProvenanceValue,
  type SourceLocation,
} from 'autocatalog-core';
import { z } from 'zod';
import { getEventMetadata, mergeMetadata, type SchemaInput } from './define-event';

export type { AdapterEvent, ProvenanceValue, SourceLocation, SchemaInput };

/** Duck-typed so schemas built by the target module's own copy of Zod still count. */
const ZodSchemaLike = z.looseObject({ safeParse: z.instanceof(Function) });

/** Any non-array object: a Zod schema instance or a JSON Schema object. */
const SchemaValue = z.looseObject({});

const CompactItemLike = z.looseObject({
  name: z.string(),
  description: z.string(),
  schema: SchemaValue,
  example: jsonValueSchema.optional(),
});

const ExplicitEventLike = z.looseObject({
  id: z.string(),
  version: z.string(),
  schema: SchemaValue,
  examples: z.array(z.looseObject({ name: z.string(), data: jsonValueSchema })),
});

export function isZodSchema<T>(value: T): value is T & z.ZodTypeAny {
  return ZodSchemaLike.safeParse(value).success;
}

/** Zod output and hand-written JSON Schema alike are checked to be plain JSON. */
export function toJsonSchema(schema: SchemaInput): JsonObject {
  return jsonObjectSchema.parse(isZodSchema(schema) ? z.toJSONSchema(schema) : schema);
}

export interface ParsedCompactName {
  version: string;
  id: string;
  domain: string;
  pascalName: string;
}

export interface CompactItem {
  name: string;
  description: string;
  schema: SchemaInput;
  example?: JsonValue;
}

const VERSION_RE = /^(v\d+)\.(.+)$/;

function titleCase(pascal: string): string {
  return pascal.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function parseCompactName(compactName: string): ParsedCompactName {
  const match = VERSION_RE.exec(compactName);

  if (!match) {
    throw new Error(
      `Compact name "${compactName}" is missing a version prefix (e.g. "v1.foo.bar")`,
    );
  }

  const version = match[1]!;
  const id = match[2]!;
  const firstSegment = id.split('.')[0]!;

  return { version, id, domain: firstSegment, pascalName: pascalCase(id) };
}

export function compactItemToAutocatalogEvent(item: CompactItem): AdapterEvent {
  const parsed = parseCompactName(item.name);
  const examples = item.example !== undefined ? [{ name: 'default', data: item.example }] : [];
  // getEventMetadata must be called before zod-to-json-schema conversion
  // (the Zod schema object carries the symbol; the plain JSON output does not)
  const schemaMeta = getEventMetadata(item.schema);
  const meta = mergeMetadata(undefined, schemaMeta);

  return {
    id: parsed.id,
    version: parsed.version,
    name: titleCase(parsed.pascalName),
    summary: item.description,
    domain: meta?.domain ?? parsed.domain,
    folderName: parsed.pascalName,
    schema: toJsonSchema(item.schema),
    examples,
    meta,
    provenance: { default: 'extracted' },
  };
}

// --- Explicit event shape (id, version, name, summary, schema, ...) ---

export interface ExplicitEvent extends Omit<
  AdapterEvent,
  'folderName' | 'name' | 'meta' | 'domain' | 'schema'
> {
  schema: SchemaInput;
  name: string;
  folderName?: string;
  domain?: string;
  team?: string;
  producers?: string[];
  consumers?: string[];
  tags?: string[];
}

export function isCompactItem<T>(item: T): item is T & CompactItem {
  return CompactItemLike.safeParse(item).success;
}

export function isExplicitEvent<T>(item: T): item is T & ExplicitEvent {
  return ExplicitEventLike.safeParse(item).success;
}

export function explicitToAdapterEvent(e: ExplicitEvent): AdapterEvent {
  const folderName = e.folderName ?? pascalCase(e.id);
  const schemaMeta = getEventMetadata(e.schema);

  const meta = mergeMetadata(
    {
      domain: e.domain,
      team: e.team,
      producers: e.producers,
      consumers: e.consumers,
      tags: e.tags,
    },
    schemaMeta,
  );

  return {
    id: e.id,
    version: e.version,
    name: e.name,
    summary: e.summary,
    domain: meta?.domain ?? e.id.split('.')[0]!,
    folderName,
    schema: toJsonSchema(e.schema),
    examples: e.examples,
    meta,
    provenance: { default: 'extracted' },
  };
}

export function toAdapterEvent(item: ExplicitEvent | CompactItem): AdapterEvent {
  return isExplicitEvent(item) ? explicitToAdapterEvent(item) : compactItemToAutocatalogEvent(item);
}
