import type { EventFrontmatter, JsonObject, JsonValue } from 'autocatalog-core';
import type { z } from 'zod';

export interface EventDeprecation {
  since: string;
  replacedBy?: { id: string; version?: string };
  notes?: string;
}

/**
 * Metadata attachable to a Zod schema via defineEvent(). With id + version
 * present a standalone schema export is a complete event definition; without
 * them the scanner derives identity from the export name and flags the event
 * for review.
 */
export interface EventMetadata {
  id?: string;
  version?: string;
  name?: string;
  summary?: string;
  domain?: string;
  team?: string;
  producers?: string[];
  consumers?: string[];
  /** Payload paths each consumer reads, by consumer name (`items[].sku`). */
  consumerFields?: Record<string, string[]>;
  tags?: string[];
  status?: 'active' | 'deprecated' | 'draft';
  deprecation?: EventDeprecation;
  /** What consumers may rely on about arrival: guarantee, ordering, idempotency, lateness. */
  delivery?: EventFrontmatter['delivery'];
  example?: JsonValue;
}

export const AUTOCATALOG_META: unique symbol = Symbol.for('autocatalog:meta');

/** A schema value that defineEvent() may have tagged with metadata. */
interface EventMetadataCarrier {
  [AUTOCATALOG_META]?: EventMetadata;
}

/** An item's schema: a (possibly defineEvent-tagged) Zod schema, or already-converted JSON Schema. */
export type SchemaInput = (z.ZodTypeAny | JsonObject) & EventMetadataCarrier;

export function defineEvent<T extends z.ZodTypeAny>(meta: EventMetadata, schema: T): T {
  return Object.assign(schema, { [AUTOCATALOG_META]: meta });
}

export function getEventMetadata(schema: SchemaInput | undefined): EventMetadata | undefined {
  return schema && Object.hasOwn(schema, AUTOCATALOG_META) ? schema[AUTOCATALOG_META] : undefined;
}

/**
 * Merge explicit top-level metadata fields with schema-embedded metadata.
 * Explicit fields win over schema metadata. Returns undefined when no metadata
 * is present on either side.
 */
export function mergeMetadata(
  explicit: Partial<EventMetadata> | undefined,
  schemaMeta: EventMetadata | undefined,
): EventMetadata | undefined {
  if (!explicit && !schemaMeta) return undefined;

  const merged: EventMetadata = {
    id: explicit?.id ?? schemaMeta?.id,
    version: explicit?.version ?? schemaMeta?.version,
    name: explicit?.name ?? schemaMeta?.name,
    summary: explicit?.summary ?? schemaMeta?.summary,
    domain: explicit?.domain ?? schemaMeta?.domain,
    team: explicit?.team ?? schemaMeta?.team,
    producers: explicit?.producers ?? schemaMeta?.producers,
    consumers: explicit?.consumers ?? schemaMeta?.consumers,
    consumerFields: explicit?.consumerFields ?? schemaMeta?.consumerFields,
    tags: explicit?.tags ?? schemaMeta?.tags,
    status: explicit?.status ?? schemaMeta?.status,
    deprecation: explicit?.deprecation ?? schemaMeta?.deprecation,
    delivery: explicit?.delivery ?? schemaMeta?.delivery,
    example: explicit?.example ?? schemaMeta?.example,
  };

  const hasValues = Object.values(merged).some((v) => v !== undefined);

  return hasValues ? merged : undefined;
}
