import fs from 'node:fs/promises';
import { z } from 'zod';
import type { AdapterEvent } from './adapter-event';
import { observationSource } from './schema';

/**
 * A runtime architecture snapshot: what the running system was actually seen
 * to do, over some window.
 *
 * This is a *contract*, not an integration. `autotel-subscribers` writes this
 * shape today, but nothing here imports it: any runtime in any language that
 * emits these fields is a first-class source of evidence. Depending on the
 * producer would break the same rule this catalog exists to enforce — a
 * consumer reads the committed artifact, it does not import the producer.
 *
 * @see https://www.npmjs.com/package/autotel-subscribers
 */
export const SNAPSHOT_SPEC_PREFIX = 'autotel-architecture/';

export interface SnapshotObservation {
  name: string;
  observedCount: number;
  firstSeen: string;
  lastSeen: string;
  producer?: string;
  consumers?: string[];
  channel?: string;
  fieldPaths?: string[];
  sampleTraceIds?: string[];
  sources?: z.infer<typeof observationSource>[];
  fieldStats?: Record<string, { types: string[] }>;
  consumerEvidence?: 'reported' | 'observed' | 'unknown';
}

export interface ArchitectureSnapshot {
  spec: string;
  generatedAt: string;
  service: string;
  events: Record<string, SnapshotObservation>;
}

const jsonObject = z.looseObject({});

const snapshotObservation = z.looseObject({
  name: z.string(),
  observedCount: z.number().int().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  producer: z.string().optional(),
  consumers: z.array(z.string()).optional(),
  channel: z.string().optional(),
  fieldPaths: z.array(z.string()).optional(),
  sampleTraceIds: z.array(z.string().min(1).max(128)).max(10).optional(),
  sources: z.array(observationSource).optional(),
  // Sample values may contain sensitive payloads; only retain structural types.
  fieldStats: z.record(z.string(), z.object({ types: z.array(z.string()) })).optional(),
  consumerEvidence: z.enum(['reported', 'observed', 'unknown']).optional(),
}) satisfies z.ZodType<SnapshotObservation>;

const snapshotSpec = z.string().startsWith(SNAPSHOT_SPEC_PREFIX);

// Missing metadata reads as empty rather than failing the whole snapshot.
const optionalText = z.string().catch('');

/**
 * Read a snapshot, refusing anything that is not recognisably one.
 *
 * A snapshot silently read as empty is worse than no snapshot: every declared
 * event would be reported as never observed, and a wall of false findings is
 * how a gate gets switched off.
 */
export async function readSnapshot(filePath: string): Promise<ArchitectureSnapshot> {
  let raw: string;

  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read snapshot at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Snapshot is not valid JSON: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }

  const root = jsonObject.safeParse(parsed);

  if (!root.success) throw new Error(`Snapshot must be a JSON object: ${filePath}`);

  const spec = snapshotSpec.safeParse(root.data.spec);

  if (!spec.success) {
    throw new Error(
      `Not an architecture snapshot: ${filePath} (spec must start with "${SNAPSHOT_SPEC_PREFIX}")`,
    );
  }

  if (!jsonObject.safeParse(root.data.events).success) {
    throw new Error(`Snapshot has no events object: ${filePath}`);
  }

  const events = z.record(z.string(), snapshotObservation).safeParse(root.data.events);

  if (!events.success) {
    throw new Error(
      `Snapshot has a malformed event observation: ${filePath} (${events.error.message})`,
    );
  }

  return {
    spec: spec.data,
    generatedAt: optionalText.parse(root.data.generatedAt),
    service: optionalText.parse(root.data.service),
    events: events.data,
  };
}

export interface SnapshotMergeResult {
  /** Events the runtime saw that the catalog does not document. */
  undocumented: string[];
  /** Catalogued events the snapshot never saw. */
  neverObserved: string[];
  /** Events the evidence touched. */
  observed: number;
}

/**
 * Join runtime evidence onto scanned events.
 *
 * Evidence never overwrites a declared or extracted fact — it is added beside
 * it. A consumer the snapshot records but nobody documented is appended with
 * provenance `observed`. The attribution strength is retained separately: a
 * runtime subscriber may report metadata rather than observe delivery.
 */
/**
 * Which catalogued event each snapshot observation names: `domain/id`, or a
 * bare id when only one domain has it. Throws on an ambiguous or duplicate
 * claim rather than guessing.
 */
export function matchSnapshot<T>(
  events: T[],
  identify: (event: T) => { domain: string; id: string },
  snapshot: ArchitectureSnapshot,
): { matches: Map<string, T> } & Omit<SnapshotMergeResult, 'observed'> {
  const byId = new Map<string, T>();
  const qualified = new Map<string, T>();
  const ambiguous = new Set<string>();

  for (const event of events) {
    const { domain, id } = identify(event);
    qualified.set(`${domain}/${id}`, event);

    if (byId.has(id)) ambiguous.add(id);
    else byId.set(id, event);
  }

  const matches = new Map<string, T>();
  const seen = new Set<string>();

  for (const name of Object.keys(snapshot.events)) {
    if (!qualified.has(name) && ambiguous.has(name)) {
      throw new Error(`Ambiguous snapshot event: ${name}. Use domain/id to identify it.`);
    }

    const event = qualified.get(name) ?? byId.get(name);

    if (!event) continue;

    const { domain, id } = identify(event);
    const key = `${domain}/${id}`;

    if (seen.has(key)) throw new Error(`Duplicate snapshot observation for ${key}`);

    seen.add(key);
    matches.set(name, event);
  }

  return {
    matches,
    undocumented: Object.keys(snapshot.events)
      .filter((name) => !matches.has(name))
      .sort(),
    neverObserved: events
      .flatMap((event) => {
        const { domain, id } = identify(event);

        return seen.has(`${domain}/${id}`) ? [] : [ambiguous.has(id) ? `${domain}/${id}` : id];
      })
      .sort(),
  };
}

export function applySnapshot(
  events: Array<Pick<AdapterEvent, 'domain' | 'id' | 'meta' | 'provenance' | 'observed'>>,
  snapshot: ArchitectureSnapshot,
): SnapshotMergeResult {
  // Resolve the whole snapshot before mutation: an ambiguous or duplicate
  // claim must not leave a plausible-looking partially enriched catalog.
  const { matches, undocumented, neverObserved } = matchSnapshot(events, (e) => e, snapshot);

  let observed = 0;

  for (const [name, observation] of Object.entries(snapshot.events)) {
    const event = matches.get(name);

    if (!event) continue;
    observed += 1;

    const declaredConsumers = event.observed?.declaredConsumers ?? event.meta?.consumers ?? [];
    const observedConsumers = observation.consumers ?? [];

    const observedProducers = [
      ...new Set([
        ...(observation.producer ? [observation.producer] : []),
        ...(observation.sources ?? []).flatMap((source) =>
          source.producer ? [source.producer] : [],
        ),
      ]),
    ].sort();

    event.observed = {
      count: observation.observedCount ?? 0,
      firstSeen: observation.firstSeen ?? '',
      lastSeen: observation.lastSeen ?? '',
      consumers: observedConsumers,
      producers: observedProducers,
      snapshot: { spec: snapshot.spec, generatedAt: snapshot.generatedAt },
      declaredConsumers: [...declaredConsumers],
      consumerEvidence: observation.consumerEvidence ?? 'reported',
      sampleTraceIds: observation.sampleTraceIds,
      sources: observation.sources,
      fieldPaths: observation.fieldPaths,
      fieldTypes: observation.fieldStats
        ? Object.fromEntries(
            Object.entries(observation.fieldStats).map(([field, stats]) => [field, stats.types]),
          )
        : undefined,
    };

    // Retain snapshot participants for impact without presenting them as
    // declarations. consumerEvidence distinguishes metadata from delivery.
    const additions = observedConsumers.filter((consumer) => !declaredConsumers.includes(consumer));

    if (additions.length > 0) {
      event.meta = { ...event.meta, consumers: [...declaredConsumers, ...additions] };
      event.provenance = {
        default: event.provenance?.default ?? 'inferred',
        fields: { ...event.provenance?.fields, consumers: 'observed' },
      };
    }
  }

  return { observed, undocumented, neverObserved };
}
