import { z } from 'zod';
import type { AdapterEvent } from './adapter-event';
import { eventConfidenceScore } from './adapter-event';
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from './json';

export interface ScanFindingBase {
  file: string;
  symbol: string;
  line?: number;
  kind: string;
  id: string;
  needsReview: boolean;
  source?: 'zod' | 'json-schema' | string;
}

/** One indivisible claim made by a discovery Adapter. */
export interface DiscoveryCandidate<TFinding extends ScanFindingBase = ScanFindingBase> {
  event: AdapterEvent;
  finding: TFinding;
}

export interface DiscoverResult {
  candidates: DiscoveryCandidate[];
  errors: string[];
  /**
   * Files an Adapter recognised and chose not to catalog, each with why. Not
   * errors: they never block publication, but nobody should have to guess why
   * a contract they committed is missing.
   */
  skipped?: string[];
}

/** Read-only compatibility projection; candidates remain the source of truth. */
export interface DiscoveryOutput extends DiscoverResult {
  events: AdapterEvent[];
  findings: ScanFindingBase[];
}

interface LegacyDiscoverResult {
  events: AdapterEvent[];
  findings: ScanFindingBase[];
  errors: string[];
}

export interface DiscoveryContext {
  root: string;
  outDir?: string;
  exclude?: string[];
  signal?: AbortSignal;
  limits?: DiscoveryLimits;
}

export interface DiscoveryLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxCandidates?: number;
}

/** Stable Scanner Seam implemented by built-in and third-party discovery Adapters. */
export interface DiscoveryAdapter {
  name: string;
  discover(context: DiscoveryContext): Promise<DiscoverResult>;
}

export class DiscoveryAdapterContractError extends Error {
  readonly code = 'adapter_protocol_invalid';
  constructor(adapterName: string, detail: string) {
    super(`Discovery Adapter ${adapterName} violated autocatalog/discovery-v1: ${detail}`);
    this.name = 'DiscoveryAdapterContractError';
  }
}

const anything = z.unknown();

// Zod 4 treats a bare z.unknown() key as required; unchecked fields may be absent.
const unchecked = anything.optional();

/** What `typeof value === 'object'` admitted: any non-null object, arrays included. */
const objectLike = z.union([z.looseObject({}), z.array(anything)]);

const envelopeSchema = z.looseObject({ candidates: z.array(anything), errors: z.array(anything) });

const candidateSchema = z.looseObject({ event: z.looseObject({}), finding: z.looseObject({}) });

// Field by field, so a rejection can name every field that is wrong.
const eventFields = {
  id: z.string().min(1),
  domain: z.string(),
  folderName: z.string(),
  schema: jsonObjectSchema,
  examples: z.array(z.object({ name: z.string(), data: jsonValueSchema })),
};

// discovery-v1 has never checked the rest; listed so no AdapterEvent field is stripped.
const adapterEventFields = {
  ...eventFields,
  version: unchecked,
  name: unchecked,
  summary: unchecked,
  meta: unchecked,
  source: unchecked,
  provenance: unchecked,
  observed: unchecked,
  confidence: unchecked,
  needsReview: unchecked,
} satisfies Record<keyof AdapterEvent, z.ZodType>;

const eventSchema = z.object(adapterEventFields);

const findingSchema = z.looseObject({
  id: z.string(),
  file: z.string(),
  symbol: z.string(),
  kind: z.string(),
  needsReview: z.boolean(),
});

/**
 * Decode an adapter's result at the trust boundary: in-process adapters are
 * third-party code, and out-of-process ones arrive as parsed JSON.
 */
export function validateDiscoveryResult(
  adapterName: string,
  value: DiscoverResult | JsonValue | undefined,
  maxCandidates = 10_000,
): DiscoverResult {
  if (!objectLike.safeParse(value).success) {
    throw new DiscoveryAdapterContractError(adapterName, 'result must be an object');
  }

  const envelope = envelopeSchema.safeParse(value);

  if (!envelope.success) {
    throw new DiscoveryAdapterContractError(adapterName, 'candidates and errors must be arrays');
  }

  const { candidates } = envelope.data;

  if (candidates.length > maxCandidates) {
    throw new DiscoveryAdapterContractError(
      adapterName,
      `candidate limit exceeded (${candidates.length} > ${maxCandidates})`,
    );
  }

  const errors = z.array(z.string()).safeParse(envelope.data.errors);

  if (!errors.success) {
    throw new DiscoveryAdapterContractError(adapterName, 'every error must be a string');
  }

  const valid: DiscoveryCandidate[] = [];

  for (const [index, raw] of candidates.entries()) {
    const candidate = candidateSchema.safeParse(raw);

    if (!candidate.success) {
      throw new DiscoveryAdapterContractError(adapterName, `candidate ${index} is malformed`);
    }

    // Name the file and the field. Refusing to publish a partial catalog is the
    // point, but "candidate 623 has an invalid Event" tells a user nothing they
    // can act on, and an unfixable error is indistinguishable from a broken tool.
    const file = z.string().min(1).safeParse(candidate.data.finding.file);
    const where = file.success ? file.data : `candidate ${index}`;
    const event = eventSchema.safeParse(candidate.data.event);

    if (!event.success) {
      const invalid = Object.keys(eventFields).filter((field) =>
        event.error.issues.some((issue) => issue.path[0] === field),
      );

      throw new DiscoveryAdapterContractError(
        adapterName,
        `${where}: invalid Event (${invalid.join(', ')})`,
      );
    }

    const finding = findingSchema.safeParse(candidate.data.finding);

    if (!finding.success || finding.data.id !== event.data.id) {
      throw new DiscoveryAdapterContractError(
        adapterName,
        `candidate ${index} finding does not describe Event ${event.data.id}`,
      );
    }

    // SAFETY: every AdapterEvent key was decoded above (the `satisfies` keeps the
    // list complete); discovery-v1 only checks the listed fields, and the rest
    // (version, name, summary, ...) is taken as the adapter declared it.
    valid.push({ event: event.data as AdapterEvent, finding: finding.data });
  }

  const skipped = z.array(z.string()).optional().safeParse(envelope.data.skipped);

  if (!skipped.success) {
    throw new DiscoveryAdapterContractError(adapterName, 'every skipped note must be a string');
  }

  return { candidates: valid, errors: errors.data, skipped: skipped.data ?? [] };
}

export interface MergeDiscoveriesResult extends DiscoveryOutput {
  conflicts: DiscoveryConflict[];
  skipped: string[];
}

export interface DiscoveryConflict {
  eventId: string;
  winner: string;
  ignored: string;
  reason: string;
}

/**
 * Merge discoveries from multiple extractors by event id.
 * Prefer higher provenance/confidence (declared > extracted > inferred).
 */
export function mergeDiscoveries(
  results: Array<DiscoverResult | LegacyDiscoverResult>,
): MergeDiscoveriesResult {
  const byId = new Map<string, DiscoveryCandidate>();
  const errors: string[] = [];
  const skipped: string[] = [];
  const conflicts: DiscoveryConflict[] = [];

  for (const result of results) {
    errors.push(...result.errors);

    if ('skipped' in result) skipped.push(...(result.skipped ?? []));

    const inputCandidates =
      'candidates' in result
        ? result.candidates
        : result.events.map((event, index) => ({
            event,
            finding: result.findings[index] ?? {
              file: event.source?.file ?? '',
              symbol: event.source?.symbol ?? event.id,
              line: event.source?.line,
              kind: 'unknown',
              id: event.id,
              needsReview: Boolean(event.needsReview),
            },
          }));

    for (const candidate of inputCandidates) {
      const { event, finding } = candidate;
      const existing = byId.get(event.id);

      if (!existing) {
        byId.set(event.id, candidate);
        continue;
      }

      const candidateScore = eventConfidenceScore(event);
      const existingScore = eventConfidenceScore(existing.event);
      const candidateKey = `${finding.source ?? ''}:${finding.file}:${finding.symbol}`;
      const existingKey = `${existing.finding.source ?? ''}:${existing.finding.file}:${existing.finding.symbol}`;

      const candidateWins =
        candidateScore > existingScore ||
        (candidateScore === existingScore && candidateKey.localeCompare(existingKey) < 0);

      const winner = candidateWins ? candidate : existing;
      const ignored = candidateWins ? existing : candidate;
      byId.set(event.id, winner);
      conflicts.push({
        eventId: event.id,
        winner: `${winner.finding.source ?? 'unknown'}:${winner.finding.file}`,
        ignored: `${ignored.finding.source ?? 'unknown'}:${ignored.finding.file}`,
        reason:
          candidateScore === existingScore
            ? 'equal confidence; deterministic source ordering applied'
            : 'higher provenance/confidence',
      });
    }
  }

  const candidates = [...byId.values()].sort((a, b) => a.event.id.localeCompare(b.event.id));

  return {
    candidates,
    events: candidates.map((candidate) => candidate.event),
    findings: candidates.map((candidate) => candidate.finding),
    errors,
    conflicts,
    skipped,
  };
}
