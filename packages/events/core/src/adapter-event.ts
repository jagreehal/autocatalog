/**
 * Language-agnostic event shape used by every extractor.
 * Adapters (Zod, Pydantic, JSON Schema, …) emit this; core writes it to disk.
 * The payload `schema` field is always JSON Schema — never a language AST.
 */

import { z } from 'zod';

import { isJsonObject, jsonValueSchema, type JsonObject, type JsonValue } from './json';
import {
  CLASSIFICATION_VALUES,
  type Classification,
  type EventFrontmatter,
  type ProvenanceValue,
} from './schema';
import type { ExampleCase, LoadedEvent } from './load';
import { cloudEventsEnvelope, type CloudEventsEnvelope } from './cloudevents';

export type { ProvenanceValue };

export interface SourceLocation {
  type?: 'code' | 'github_clone' | 'url';
  file?: string; // repo-relative path to the defining module/file
  symbol?: string;
  line?: number;
  repo?: string;
  ref?: string;
  schema?: string;
}

export interface AdapterEventDeprecation {
  since: string;
  replacedBy?: { id: string; version?: string };
  notes?: string;
}

/** Optional metadata attached by an extractor or sidecar. */
export interface AdapterEventMeta {
  envelope?: CloudEventsEnvelope;
  id?: string;
  version?: string;
  name?: string;
  summary?: string;
  domain?: string;
  team?: string;
  owner?: { team: string; name?: string; contact?: string };
  producers?: string[];
  consumers?: string[];
  /** Payload paths each consumer reads, by consumer name. */
  consumerFields?: Record<string, string[]>;
  tags?: string[];
  status?: 'active' | 'deprecated' | 'draft';
  classification?: Classification;
  badges?: Array<{ content: string; backgroundColor?: string; textColor?: string }>;
  deprecation?: AdapterEventDeprecation;
  transport?: Array<{
    address?: string;
    protocols?: string[];
    deliveryMode?: 'push' | 'pull' | 'push-pull';
  }>;
  delivery?: EventFrontmatter['delivery'];
  example?: JsonValue;
}

/** Vendor extension keys carrying event metadata inside a committed schema. */
const VENDOR_META_KEYS = ['x-autocatalog', 'x-eventcatalog'] as const;

/**
 * Read event metadata a repository committed inside its own schema.
 *
 * `x-eventcatalog` is read alongside our own key on purpose. It is an
 * established, published convention that repositories already commit, and a
 * scanner that recognises only its own namespace is not automatic — it is the
 * same manual tax under a different name. Our key wins where both are present.
 */
export function readVendorMeta(schema: JsonObject): AdapterEventMeta | undefined {
  for (const key of VENDOR_META_KEYS) {
    const value = schema[key];

    if (isJsonObject(value)) return parseAdapterEventMeta(value);
  }

  return undefined;
}

const field = <T extends z.ZodType>(schema: T) => schema.optional();

const text = field(z.string());

const strings = field(z.array(z.string()));

// Unknown keys are kept: metadata is read before anything decides what it holds.
const adapterEventMeta = z.looseObject({
  envelope: field(cloudEventsEnvelope),
  id: text,
  version: text,
  name: text,
  summary: text,
  domain: text,
  team: text,
  owner: field(
    z.object({ team: z.string(), name: z.string().optional(), contact: z.string().optional() }),
  ),
  producers: strings,
  consumers: strings,
  consumerFields: field(z.record(z.string(), z.array(z.string()))),
  tags: strings,
  status: field(z.enum(['active', 'deprecated', 'draft'])),
  classification: field(z.enum(CLASSIFICATION_VALUES)),
  badges: field(
    z.array(
      z.object({
        content: z.string(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
      }),
    ),
  ),
  deprecation: field(
    z.object({
      since: z.string(),
      replacedBy: z.object({ id: z.string(), version: z.string().optional() }).optional(),
      notes: z.string().optional(),
    }),
  ),
  example: field(jsonValueSchema),
});

// `x-eventcatalog` spells ownership as `owners: string[]`; we keep one team.
const ownersSchema = z.array(z.string().nullable().catch(null)).catch([]);

/** Parse event metadata committed in a schema or sidecar into its typed form. */
export function parseAdapterEventMeta(raw: JsonObject): AdapterEventMeta {
  const { owners, ...fields } = raw;
  const parsed = adapterEventMeta.safeParse(fields);
  // SAFETY: metadata of the wrong shape is passed on as written, on purpose.
  // The catalog's own validation rejects it with the event named; dropping the
  // field here would publish `status: retired` as an active event, silently.
  const meta = parsed.success ? parsed.data : (fields as AdapterEventMeta);

  if (meta.owner) return meta;
  const team = ownersSchema.parse(owners ?? []).find((value) => value !== null);

  return team ? { ...meta, owner: { team } } : meta;
}

export interface AdapterEvent {
  id: string;
  version: string;
  name: string;
  summary: string;
  domain: string;
  folderName: string;
  /** JSON Schema object (draft 2020-12 preferred). */
  schema: JsonObject;
  /** A `case` puts the example under examples/<case>/; without one it is the happy path. */
  examples: Array<{ name: string; data: JsonValue; case?: ExampleCase }>;
  meta?: AdapterEventMeta;
  source?: SourceLocation;
  provenance?: { default: ProvenanceValue; fields?: Record<string, ProvenanceValue> };
  /** What the running system was seen to do, when a snapshot was supplied. */
  observed?: EventFrontmatter['observed'];
  confidence?: number;
  needsReview?: boolean;
}

export function loadedEventToAdapterEvent(loaded: LoadedEvent): AdapterEvent {
  const fm = loaded.frontmatter;

  return {
    id: fm.id,
    version: fm.version,
    name: fm.name,
    summary: fm.summary,
    domain: fm.domain,
    folderName: pathBasename(
      loaded.folder.isVersioned ? loaded.folder.parentEventPath! : loaded.folder.path,
    ),
    schema: loaded.schema,
    examples: loaded.examples.map((example) => ({
      name: example.name,
      data: example.data,
      ...(example.case && { case: example.case }),
    })),
    meta: {
      owner: fm.owner,
      status: fm.status,
      classification: fm.classification,
      producers: fm.producers,
      consumers: fm.consumers,
      consumerFields: fm.consumerFields,
      tags: fm.tags,
      badges: fm.badges,
      deprecation: fm.deprecation,
      transport: fm.transport,
      delivery: fm.delivery,
      envelope: fm.envelope,
    },
    source: fm.source,
    provenance: fm.provenance,
    confidence: fm.confidence,
    needsReview: fm.needsReview,
  };
}

function pathBasename(value: string): string {
  const normalized = value.replace(/[\\/]+$/, '');

  return normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')) + 1);
}

/** Rank for merge: declared > extracted > inferred. */
export function provenanceRank(value: ProvenanceValue | undefined): number {
  switch (value) {
    case 'overridden':
      return 4;
    case 'declared':
      return 3;
    case 'extracted':
      return 2;
    // Observation proves something happened; it does not say what the contract
    // is. It outranks a heuristic and never outranks a definition read from
    // source. In practice a snapshot annotates events rather than discovering
    // them, so this arm is a guard rather than a path.
    case 'observed':
      return 1.5;
    case 'inferred':
      return 1;
    case undefined:
      return 0;
    default: {
      const _exhaustive: never = value;

      return _exhaustive;
    }
  }
}

/** Higher is better. Used when merging multi-source scan findings by event id. */
export function eventConfidenceScore(event: AdapterEvent): number {
  const prov = provenanceRank(event.provenance?.default);
  const conf = event.confidence ?? 0;
  const reviewPenalty = event.needsReview ? 0 : 0.05;

  return prov * 10 + conf + reviewPenalty;
}
