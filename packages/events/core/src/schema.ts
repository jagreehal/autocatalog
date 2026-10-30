import { z } from 'zod';
import { cloudEventsEnvelope } from './cloudevents';

export const AUTOCATALOG_SPEC_VERSION = 'autocatalog/v2';

export const AUTOCATALOG_EVENT_FILE = 'autocatalog.json';

/**
 * Where a piece of metadata came from. "declared" = a human wrote it,
 * "extracted" = read directly from source code, "inferred" = derived by
 * heuristics (conventions, CODEOWNERS, git history) and may be wrong,
 * "observed" = the running system did it, and a snapshot recorded that.
 *
 * Observed records a runtime source, whose attribution may be reported
 * metadata rather than proof of delivery. A consumer absent from the
 * evidence is not necessarily absent from production.
 */
export const PROVENANCE_VALUES = [
  'declared',
  'extracted',
  'inferred',
  'overridden',
  'observed',
] as const;

const provenanceValue = z.enum(PROVENANCE_VALUES);

/**
 * Who an event is for, from narrowest to widest audience: "internal" stays
 * inside the producing service, "domain" inside its Domain, "integration"
 * crosses Domains within the organisation, "public" leaves it. A wider event
 * is a harder contract to change, which is the point of saying so.
 */
export const CLASSIFICATION_VALUES = ['internal', 'domain', 'integration', 'public'] as const;

const provenance = z.object({
  default: provenanceValue.default('declared'),
  // Per-field overrides, keyed by top-level manifest field name.
  fields: z.record(z.string(), provenanceValue).default({}),
});

const badge = z.object({
  content: z.string(),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
});

const owner = z.object({
  team: z.string(),
  /** How the team is shown, when its id is not how people know it. */
  name: z.string().min(1).optional(),
  contact: z.string().url().optional(),
});

const replacedByRef = z.object({
  id: z.string(),
  version: z.string().optional(),
});

const deprecation = z.object({
  since: z.string(),
  replacedBy: replacedByRef.optional(),
  notes: z.string().optional(),
});

/**
 * What the running system was seen to do, from a runtime snapshot.
 *
 * Liveness is evidence about the event, not about where a field's value came
 * from — which is why it sits beside `provenance` rather than inside it.
 */
export const observationSource = z.object({
  producer: z.string().optional(),
  channel: z.string().optional(),
  count: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});

/**
 * What one consumer did with the deliveries it received in the snapshot's
 * window: how many failed, were retried, went to a dead-letter queue or came
 * back from one, and why they were dead-lettered.
 */
export const consumerOutcome = z.object({
  consumer: z.string(),
  channel: z.string().optional(),
  count: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative().optional(),
  retried: z.number().int().nonnegative().optional(),
  deadLettered: z.number().int().nonnegative().optional(),
  replayed: z.number().int().nonnegative().optional(),
  deadLetterReasons: z
    .array(
      z.object({
        reason: z.string().max(200),
        category: z.string().optional(),
        queue: z.string().optional(),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(10)
    .optional(),
});

export type ConsumerOutcome = z.infer<typeof consumerOutcome>;

const observed = z.object({
  /** Times the event was seen during the observed window. */
  count: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  /** Consumer participants; consumerEvidence identifies attribution strength. */
  consumers: z.array(z.string()).default([]),
  /** Producers attributed by the snapshot. */
  producers: z.array(z.string()).default([]),
  /** Bounded references for fetching details from a telemetry backend. */
  sampleTraceIds: z.array(z.string().min(1).max(128)).max(10).optional(),
  sources: z.array(observationSource).optional(),
  /** Consumers whose deliveries failed, retried or went to a dead-letter queue. */
  consumerOutcomes: z.array(consumerOutcome).optional(),
  fieldPaths: z.array(z.string()).optional(),
  fieldTypes: z.record(z.string(), z.array(z.string())).optional(),
  /** Preserve the declaration before snapshot enrichment adds consumers. */
  declaredConsumers: z.array(z.string()).optional(),
  /** Legacy snapshots report consumer metadata, not delivery proof. */
  consumerEvidence: z.enum(['reported', 'observed', 'unknown']).optional(),
  /** Which snapshot said so, so a stale claim can be traced to its source. */
  snapshot: z.object({ spec: z.string(), generatedAt: z.string() }),
});

const source = z.object({
  type: z.enum(['code', 'github_clone', 'url']).optional(),
  repo: z.string().optional(),
  ref: z.string().optional(),
  schema: z.string().optional(),
  // Traceability back to the defining code (type: 'code').
  file: z.string().optional(), // repo-relative path
  symbol: z.string().optional(), // export or identifier name
  line: z.number().int().positive().optional(),
});

/**
 * Where the event travels, as the spec that declared it says: a topic, queue
 * or channel address, the protocols that carry it, and EventCatalog's delivery
 * mode. Context for a reader, never part of the payload contract.
 */
const transport = z.object({
  address: z.string().optional(),
  protocols: z.array(z.string()).default([]),
  deliveryMode: z.enum(['push', 'pull', 'push-pull']).optional(),
});

/**
 * What consumers may rely on about arrival, beyond the payload's shape: how
 * often an event can arrive, which field orders it, and which field identifies
 * a repeat. Keys are payload paths in the same form as `consumerFields`.
 */
const DURATION_RE =
  /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * An ISO 8601 duration in seconds, or undefined when it is not one. Only days
 * and smaller: a month or a year has no fixed length to compare.
 */
export function durationSeconds(value: string): number | undefined {
  const match = DURATION_RE.exec(value);

  if (!match || value === 'P' || value.endsWith('T')) return undefined;

  const [days = 0, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => Number(part ?? 0));

  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

const delivery = z.object({
  guarantee: z.enum(['at-least-once', 'at-most-once', 'exactly-once']).optional(),
  orderingKey: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  /** The field that ties this event to the journey it is part of, for tracing. */
  correlationKey: z.string().min(1).optional(),
  /** How long after it happened an event may still arrive, as an ISO 8601 duration. */
  maxLateness: z
    .string()
    .refine((value) => durationSeconds(value) !== undefined, {
      message: 'must be an ISO 8601 duration in days or less, such as PT5M',
    })
    .optional(),
});

export const eventFrontmatter = z.object({
  spec: z.literal('autocatalog/v2').default('autocatalog/v2'),
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  domain: z.string().optional(),
  owner: owner.optional(),
  status: z.enum(['active', 'deprecated', 'draft']).default('active'),
  classification: z.enum(CLASSIFICATION_VALUES).optional(),
  producers: z.array(z.string()).default([]),
  consumers: z.array(z.string()).default([]),
  /**
   * The payload fields a consumer says it reads, by consumer name, as dotted
   * paths with `[]` for array items (`items[].sku`). A consumer with no entry
   * has not said, and a breaking change is assumed to reach it.
   */
  consumerFields: z.record(z.string(), z.array(z.string())).optional(),
  tags: z.array(z.string()).default([]),
  badges: z.array(badge).default([]),
  schema: z.string().default('./schema.json'),
  examples: z.array(z.string()).default([]),
  deprecation: deprecation.optional(),
  source: source.optional(),
  transport: z.array(transport).optional(),
  delivery: delivery.optional(),
  envelope: cloudEventsEnvelope.optional(),
  provenance: provenance.default({ default: 'declared', fields: {} }),
  observed: observed.optional(),
  confidence: z.number().min(0).max(1).optional(),
  // Set by the scanner for convention-only finds a human has not confirmed.
  needsReview: z.boolean().default(false),
});

export type EventFrontmatter = z.infer<typeof eventFrontmatter>;

export type ProvenanceValue = (typeof PROVENANCE_VALUES)[number];

export type Classification = (typeof CLASSIFICATION_VALUES)[number];
