import fs from 'node:fs/promises';
import path from 'node:path';
import { diffSchemas, type DiffResult, type SchemaNode } from './diff';
import { fieldPaths } from './fields';
import { jsonObjectSchema } from './json';
import { loadCatalog, type LoadedEvent } from './load';
import { durationSeconds } from './schema';
import { matchSnapshot, type ArchitectureSnapshot } from './snapshot';
import { isSafeName, UNSAFE_CONSUMER } from './consumes';
import { schemaPointer, sourceLines } from './source-lines';
import type { ResourceRef } from './resource-graph';

export type DriftSeverity = 'breaking' | 'suspicious' | 'additive' | 'info';

export interface DriftFinding {
  resource?: ResourceRef;
  domain: string;
  eventId: string;
  severity: DriftSeverity;
  kind:
    | 'resource_removed'
    | 'command_multiple_handlers'
    | 'command_missing_handler'
    | 'command_missing_outcome'
    | 'command_outcome_changed'
    | 'command_handler_changed'
    | 'writer_undocumented'
    | 'cross_owner_access'
    | 'delivery_changed'
    | 'document_schema_mismatch'
    | 'document_schema_unavailable'
    | 'event_removed'
    | 'event_added'
    | 'operation_removed'
    | 'operation_added'
    | 'field_removed'
    | 'field_renamed'
    | 'type_changed'
    | 'type_narrowed'
    | 'type_widened'
    | 'required_added'
    | 'required_removed'
    | 'enum_narrowed'
    | 'enum_widened'
    | 'constraint_tightened'
    | 'constraint_loosened'
    | 'constraint_changed'
    | 'format_changed'
    | 'field_added'
    | 'description_changed'
    | 'version_unchanged'
    | 'version_bumped'
    | 'producer_removed'
    | 'producer_added'
    | 'consumer_removed'
    | 'consumer_added'
    | 'owner_changed'
    | 'event_undocumented'
    | 'field_undeclared'
    | 'event_unobserved';
  message: string;
  /** Consumers this change can break (empty for additive/info). */
  consumers: string[];
  /**
   * How `consumers` was narrowed by the fields consumers declare they read, set
   * when one of them declared any. A consumer that never said is kept in
   * `consumers` as `unspecified`: silence or invalid paths are not evidence it is safe.
   */
  usage?: { reads: string[]; unspecified: string[]; unaffected: string[] };
  /**
   * The compatibility modes this change fails, when the schema rules alone
   * would answer wrongly: an API response is read by the client, so its
   * directions are the reverse of an event's; a rename is the removal and the
   * addition it stands for.
   */
  compatibility?: Array<'backward' | 'forward'>;
  /** The field a `field_renamed` finding moved, as diff paths. */
  rename?: { from: string; to: string };
  /**
   * A breaking change the version owns up to: the event (or API) took a major
   * bump in the same change. Still reported, with who to tell, but it no
   * longer fails the severity gate. Registry strategies ignore it.
   */
  acknowledged?: boolean;
  /** What to do next, for a breaking change: how to land it without breaking anyone, or who to tell. */
  advice?: string;
  /** Where the contract is defined, when the scanner traced it back to code. */
  source?: { file: string; line?: number };
  diff?: DiffResult;
}

export interface DriftReport {
  findings: DriftFinding[];
  breaking: number;
  suspicious: number;
  additive: number;
  /** Breaking changes a major version bump acknowledged. */
  acknowledged: number;
  /** Whether any breaking change is not acknowledged — what the severity gate fails on. */
  hasBreaking: boolean;
}

function key(e: LoadedEvent): string {
  return `${e.frontmatter.domain}/${e.frontmatter.id}`;
}

/** Where the contract lives in code, when the scanner traced it. Drives CI annotations. */
function sourceOf(e: LoadedEvent): DriftFinding['source'] {
  const src = e.frontmatter.source;

  return src?.file ? { file: src.file, line: src.line } : undefined;
}

interface Classification {
  severity: DriftSeverity;
  kind: DriftFinding['kind'];
}

function classify(diff: DiffResult): Classification {
  switch (diff.kind) {
    case 'removed':
      return { severity: 'breaking', kind: 'field_removed' };
    // A wider type set is the enum widening again: old values still pass.
    case 'type_changed':
      if (diff.typeDirection === 'widened') return { severity: 'additive', kind: 'type_widened' };

      if (diff.typeDirection === 'narrowed') return { severity: 'breaking', kind: 'type_narrowed' };

      return { severity: 'breaking', kind: 'type_changed' };
    case 'required_added':
      return { severity: 'breaking', kind: 'required_added' };
    case 'required_removed':
      return { severity: 'suspicious', kind: 'required_removed' };
    // Decided from structured evidence, never from the rendered detail: an
    // enum value with a hyphen in it ("on-hold") made a widening read as a
    // narrowing when this searched the text for "-".
    case 'enum_changed':
      return (diff.enumRemoved?.length ?? 0) > 0 || diff.enumIntroduced
        ? { severity: 'breaking', kind: 'enum_narrowed' }
        : { severity: 'additive', kind: 'enum_widened' };
    case 'constraint_changed':
      if (diff.constraint?.direction === 'tightened') {
        return { severity: 'breaking', kind: 'constraint_tightened' };
      }

      if (diff.constraint?.direction === 'loosened') {
        return { severity: 'additive', kind: 'constraint_loosened' };
      }

      // A change we cannot prove safe must not pass the gate that promises to
      // catch breaks. `oneOf` gaining a branch, or a rewritten `pattern`, can
      // reject payloads that were accepted, and nothing cheap says whether it
      // does — so it is reported as breaking and a human decides.
      return { severity: 'breaking', kind: 'constraint_changed' };
    case 'format_changed':
      return diff.constraint?.direction === 'loosened'
        ? { severity: 'additive', kind: 'format_changed' }
        : { severity: 'suspicious', kind: 'format_changed' };
    case 'added':
      // Adding `properties: { blocked: false }` forbids the field rather than
      // offering it: every payload carrying it becomes invalid.
      // Typing a previously free field violates BACKWARD and is reported there.
      // Severity stays additive on purpose: adding an optional field is the
      // commonest schema change there is, and failing the default gate on it
      // is how a gate gets switched off. The two models disagree here by
      // design, as they already do for a removed optional field.
      return diff.propertyForbidden
        ? { severity: 'breaking', kind: 'field_added' }
        : { severity: 'additive', kind: 'field_added' };
    case 'description_changed':
      return { severity: 'info', kind: 'description_changed' };
  }
}

function describe(diff: DiffResult, kind: DriftFinding['kind']): string {
  switch (kind) {
    case 'field_removed':
      return `field \`${diff.path}\` (${diff.detail}) was removed`;
    case 'type_changed':
      return `field \`${diff.path}\` changed type: ${diff.detail}`;
    case 'type_narrowed':
      return `field \`${diff.path}\` accepts fewer types: ${diff.detail} — payloads that were valid can now be rejected`;
    case 'type_widened':
      return `field \`${diff.path}\` accepts more types: ${diff.detail}`;
    case 'required_added':
      return `field \`${diff.path}\` is now required — payloads that omit it become invalid`;
    case 'required_removed':
      return `field \`${diff.path}\` is no longer guaranteed — consumers relying on it may break`;
    case 'enum_narrowed':
      return diff.enumIntroduced
        ? `field \`${diff.path}\` is now restricted to an enum (${diff.detail}) — values that were valid are not any more`
        : `enum \`${diff.path}\` narrowed (${diff.detail}) — existing values may be rejected`;
    case 'constraint_tightened':
      return `\`${diff.path}\` accepts less than it did: ${diff.detail} — payloads that were valid can now be rejected`;
    case 'constraint_loosened':
      return `\`${diff.path}\` accepts more than it did: ${diff.detail}`;
    case 'constraint_changed':
      return `\`${diff.path}\` changed validation: ${diff.detail} — this cannot be shown to be safe, so it is treated as breaking until someone says otherwise`;
    case 'enum_widened':
      return `enum \`${diff.path}\` gained values (${diff.detail})`;
    case 'format_changed':
      return `field \`${diff.path}\` changed format: ${diff.detail}`;
    case 'field_added':
      return `new field \`${diff.path}\` (${diff.detail})`;
    case 'description_changed':
      return `description of \`${diff.path}\` changed`;
    default:
      return `${diff.path}: ${diff.detail}`;
  }
}

// Keywords a diff path can name below a field. Whatever follows one is about
// the field's validation, so the change is charged to the field itself.
const KEYWORD_TAIL =
  /\.(?:\*|not|if|then|else|contains|propertyNames|additionalItems|unevaluatedItems|unevaluatedProperties|prefixItems|patternProperties|dependentSchemas)(?![\w$-]).*$/;

/**
 * The payload field a diff path is about, named as the field index names it.
 * Union branches are transparent there, so they are here; empty is the root.
 */
function changedField(diffPath: string): string {
  return diffPath
    .replace(/^\(root\)/, '')
    .replace(/\|(?:anyOf|oneOf|allOf)(?:\[\d+\])?/g, '')
    .replace(KEYWORD_TAIL, '')
    .replace(/^\./, '');
}

/** One field contains the other: changing `customer` reaches `customer.email`, and back. */
function overlaps(changed: string, declared: string): boolean {
  const within = (path: string, parent: string) =>
    path === parent || (path.startsWith(parent) && /^[.[]/.test(path.slice(parent.length)));

  return changed === '' || within(changed, declared) || within(declared, changed);
}

/** Sort consumers by whether they said they read the changed field. */
function consumerUsage(
  consumers: string[],
  consumerFields: Record<string, string[]> | undefined,
  diffPath: string,
  knownFields: Set<string>,
): DriftFinding['usage'] {
  // Consumer names are data: only an own entry counts, never `constructor` from Object.
  const declaredBy = (consumer: string) =>
    consumerFields && Object.hasOwn(consumerFields, consumer)
      ? consumerFields[consumer]
      : undefined;

  if (!consumers.some((consumer) => declaredBy(consumer))) return undefined;
  const field = changedField(diffPath);
  const usage: NonNullable<DriftFinding['usage']> = { reads: [], unspecified: [], unaffected: [] };

  for (const consumer of consumers) {
    const declared = declaredBy(consumer);

    // A typo is not evidence a consumer is safe. Both versions contribute
    // paths, since a field removed by this change is still a valid declaration.
    if (!declared || declared.some((path) => !knownFields.has(path))) {
      usage.unspecified.push(consumer);
    } else if (declared.some((path) => overlaps(field, path))) usage.reads.push(consumer);
    else usage.unaffected.push(consumer);
  }

  return usage;
}

/**
 * Classify one event's schema change and name who it reaches.
 *
 * The catalog-wide drift report is this applied to every event. An agent
 * proposing a change asks the same question about one, and must get the same
 * answer CI would give it — so there is one classifier, not two.
 */
export function assessEventChange(input: {
  domain: string;
  eventId: string;
  consumers: string[];
  /** Payload paths each consumer reads, by consumer name. */
  consumerFields?: Record<string, string[]>;
  source?: DriftFinding['source'];
  previous: SchemaNode;
  proposed: SchemaNode;
}): DriftFinding[] {
  const { domain, eventId, consumers, consumerFields, source, previous, proposed } = input;
  const knownFields = new Set<string>();

  if (consumerFields) {
    for (const schema of [previous, proposed]) {
      const parsed = jsonObjectSchema.safeParse(schema);

      if (parsed.success) {
        for (const field of fieldPaths(parsed.data)) knownFields.add(field);
      }
    }
  }

  const findings = diffSchemas(previous, proposed).map((diff): DriftFinding => {
    const { severity, kind } = classify(diff);
    // Only a change that can break someone carries a notify list. An
    // additive field with a consumer list reads as an alarm nobody needs.
    const reaches = severity === 'breaking' || severity === 'suspicious';

    const usage = reaches
      ? consumerUsage(consumers, consumerFields, diff.path, knownFields)
      : undefined;

    return {
      domain,
      eventId,
      severity,
      kind,
      message: describe(diff, kind),
      consumers: !reaches ? [] : usage ? [...usage.reads, ...usage.unspecified] : consumers,
      ...(usage && { usage }),
      source,
      diff,
    };
  });

  return foldRenames(findings);
}

/** `items[].sku` → `items[]`; a top-level field's parent is the root, `''`. */
const parentPath = (diffPath: string): string =>
  diffPath.slice(0, Math.max(0, diffPath.lastIndexOf('.')));

/**
 * One field removed and one added beside it, of the same type, is almost
 * always a rename, and reporting it as a removal plus a new field reads as two
 * changes when the author made one. Deliberately narrow: the same parent, the
 * same type, and exactly one of each — anything looser guesses, and a wrong
 * guess hides a removal.
 */
function foldRenames(findings: DriftFinding[]): DriftFinding[] {
  const byParent = new Map<string, { removed: DriftFinding[]; added: DriftFinding[] }>();

  for (const finding of findings) {
    const side =
      finding.kind === 'field_removed'
        ? 'removed'
        : finding.kind === 'field_added' && !finding.diff?.propertyForbidden
          ? 'added'
          : undefined;

    if (!side || !finding.diff) continue;
    const parent = parentPath(finding.diff.path);
    const group = byParent.get(parent) ?? { removed: [], added: [] };
    group[side].push(finding);
    byParent.set(parent, group);
  }

  const renamed = new Map<DriftFinding, DriftFinding>();
  const folded = new Set<DriftFinding>();

  for (const { removed, added } of byParent.values()) {
    const [was] = removed;
    const [now] = added;

    if (removed.length !== 1 || added.length !== 1 || !was?.diff || !now?.diff) continue;

    if (was.diff.detail !== now.diff.detail) continue;
    const from = was.diff.path;
    const to = now.diff.path;

    // A required field renamed to a required one keeps its promise under a new
    // name. An optional field that comes back required is a second change.
    const required = was.diff.wasRequired
      ? findings.filter((f) => f.kind === 'required_added' && f.diff?.path === to)
      : [];

    const parts = [was, now, ...required];
    const modes = new Set(parts.flatMap((part) => compatibilityViolations(part)));

    renamed.set(was, {
      ...was,
      kind: 'field_renamed',
      message: `field \`${from}\` (${was.diff.detail}) looks renamed to \`${to}\``,
      rename: { from, to },
      compatibility: (['backward', 'forward'] as const).filter((mode) => modes.has(mode)),
    });

    for (const part of [now, ...required]) folded.add(part);
  }

  return findings.flatMap((f) => (folded.has(f) ? [] : [renamed.get(f) ?? f]));
}

/** Roll findings up into the report shape CI and the MCP tools both return. */
export function summariseDrift(findings: DriftFinding[]): DriftReport {
  const count = (severity: DriftSeverity) =>
    findings.filter((finding) => finding.severity === severity).length;

  const acknowledged = findings.filter((f) => f.severity === 'breaking' && f.acknowledged).length;

  return {
    findings,
    breaking: count('breaking'),
    suspicious: count('suspicious'),
    additive: count('additive'),
    acknowledged,
    hasBreaking: count('breaking') > acknowledged,
  };
}

/** The leading number of a version: 2 for `2.1.0`, `V2` or `v2-beta`. */
function majorOf(version: string): number | undefined {
  const digits = /^v?(\d+)/i.exec(version)?.[1];

  return digits === undefined ? undefined : Number(digits);
}

/** The next major version, spelt like this one: `1.4.2` → `2.0.0`, `V3` → `V4`. */
function nextMajor(version: string): string {
  const match = /^(v?)(\d+)(\.)?/i.exec(version);

  if (!match) return 'a new major version';
  const [, prefix = '', major = '0', dotted] = match;

  return `${prefix}${Number(major) + 1}${dotted ? '.0.0' : ''}`;
}

/** How to make the change without breaking anyone: the half of the advice a version cannot give. */
function keepCompatible(f: DriftFinding, readers: string): string {
  const field = `\`${f.diff?.path ?? ''}\``;
  const until = `until ${readers} move off it`;

  switch (f.kind) {
    case 'field_renamed':
      return `keep \`${f.rename?.from}\` alongside \`${f.rename?.to}\` ${until}`;
    case 'field_removed':
      return `keep ${field} (mark it deprecated) ${until}`;
    case 'required_added':
      return `make ${field} optional until everyone sending it does`;
    case 'type_changed':
    case 'type_narrowed':
      return `add the new type as a new field and leave ${field} as it was ${until}`;
    case 'event_removed':
      return `keep publishing it, marked deprecated, ${until}`;
    case 'operation_removed':
      return `keep the operation, marked deprecated, ${until}`;
    default:
      return `keep ${field} accepting what it did ${until}`;
  }
}

/**
 * Say what to do about each breaking change, and mark the ones the version
 * already owns up to. A major bump is how a producer says "this breaks, on
 * purpose": those stay reported, with who to tell, but stop failing the
 * severity gate. A minor or patch bump is not that, and the advice says so.
 */
export function adviseBreaking(
  findings: DriftFinding[],
  version: {
    from: string;
    /** Absent when the contract itself is gone and there is no version to bump. */
    to?: string;
    /** Where the version lives, when it is not obvious: `info.version`. */
    field?: string;
    readers?: 'consumers' | 'clients';
  },
): DriftFinding[] {
  const { from, to, readers = 'consumers' } = version;
  const bump = version.field ? `bump ${version.field}` : 'bump';
  const fromMajor = majorOf(from);
  const toMajor = to === undefined ? undefined : majorOf(to);
  const majorBump = fromMajor !== undefined && toMajor !== undefined && toMajor > fromMajor;

  return findings.map((f) => {
    if (f.severity !== 'breaking') return f;
    const notify = f.consumers.length > 0 ? f.consumers.join(', ') : `its ${readers}`;

    if (majorBump) {
      return {
        ...f,
        acknowledged: true,
        advice: `Acknowledged by the major bump ${from} → ${to}: notify ${notify} before it ships`,
      };
    }

    const keep = keepCompatible(f, readers);

    if (to === undefined) return { ...f, advice: `Next: ${keep}, and notify ${notify}` };
    const notMajor = to === from ? '' : ` (${to} is not a major bump)`;

    return {
      ...f,
      advice: `Next: ${keep}, or ${bump} to ${nextMajor(from)}${notMajor} to mark it intentional and notify ${notify}`,
    };
  });
}

/**
 * Line lookups for an event whose contract is a whole JSON Schema file, so a
 * diff path maps onto the file itself. Code-defined events keep the line the
 * scanner recorded; anything that cannot be read just has no line.
 */
async function contractLines(
  sourceRoot: string | undefined,
  e: LoadedEvent,
): Promise<ReturnType<typeof sourceLines> | undefined> {
  const src = e.frontmatter.source;

  if (!sourceRoot || !src?.file || src.line !== undefined) return undefined;

  if (src.symbol !== path.basename(src.file)) return undefined;
  const file = path.resolve(sourceRoot, src.file);

  if (path.relative(sourceRoot, file).startsWith('..')) return undefined;

  try {
    return sourceLines(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Put a finding on the line of the node it is about, when that line is known. */
export function placeFinding(
  f: DriftFinding,
  lineAt: ReturnType<typeof sourceLines> | undefined,
  steps: string[] | undefined,
): DriftFinding {
  const line = steps && lineAt?.(steps);

  return line === undefined || !f.source ? f : { ...f, source: { ...f.source, line } };
}

/** The steps from the contract root to what a finding is about, as far as its diff path says. */
export function findingPointer(f: DriftFinding): string[] | undefined {
  if (f.rename) return schemaPointer(f.rename.to);

  return f.diff ? schemaPointer(f.diff.path) : undefined;
}

/**
 * Who sends, receives and owns an event, compared between catalog versions.
 * Producer/consumer diffing modelled on EventCatalog's @eventcatalog/diff (MIT).
 *
 * None of this changes what a payload must look like, so it never fails a
 * compatibility strategy. A producer leaving is the one change that can hurt
 * someone — the event's consumers may stop receiving it — so, like a field
 * that is no longer guaranteed, it is suspicious and names them. The rest is
 * information.
 */
function architectureChanges(
  base: LoadedEvent,
  curr: LoadedEvent,
  consumers: string[],
): DriftFinding[] {
  const finding = (
    kind: DriftFinding['kind'],
    message: string,
    severity: DriftSeverity = 'info',
  ): DriftFinding => ({
    domain: curr.frontmatter.domain,
    eventId: curr.frontmatter.id,
    severity,
    kind,
    message,
    consumers: severity === 'info' ? [] : consumers,
    source: sourceOf(curr),
  });

  const missing = (from: string[], other: string[]) => from.filter((name) => !other.includes(name));
  const was = base.frontmatter;
  const now = curr.frontmatter;

  const findings = [
    ...missing(was.producers, now.producers).map((name) =>
      finding('producer_removed', `producer \`${name}\` no longer sends this event`, 'suspicious'),
    ),
    ...missing(now.producers, was.producers).map((name) =>
      finding('producer_added', `producer \`${name}\` now sends this event`),
    ),
    ...missing(was.consumers, now.consumers).map((name) =>
      finding('consumer_removed', `consumer \`${name}\` no longer receives this event`),
    ),
    ...missing(now.consumers, was.consumers).map((name) =>
      finding('consumer_added', `consumer \`${name}\` now receives this event`),
    ),
  ];

  const ownerBefore = was.owner?.team;
  const ownerAfter = now.owner?.team;

  if (ownerBefore !== ownerAfter) {
    findings.push(
      finding('owner_changed', `owner changed: ${ownerBefore ?? '∅'} → ${ownerAfter ?? '∅'}`),
    );
  }

  return findings;
}

const DELIVERY_PROMISES = [
  ['guarantee', 'delivery guarantee', ''],
  ['orderingKey', 'ordering key', ': consumers can no longer rely on the order of'],
  ['idempotencyKey', 'idempotency key', ': consumers can no longer deduplicate on'],
  ['correlationKey', 'correlation key', ': traces can no longer follow'],
  ['maxLateness', 'maximum lateness', ''],
] as const;

/**
 * What consumers were promised about arrival. Taking a promise back or changing
 * it breaks whoever built on it, as a removed field does; a new one is additive.
 */
function deliveryChanges(
  base: LoadedEvent,
  curr: LoadedEvent,
  consumers: string[],
): DriftFinding[] {
  return DELIVERY_PROMISES.flatMap(([field, label, removed]) => {
    const was = base.frontmatter.delivery?.[field];
    const now = curr.frontmatter.delivery?.[field];

    if (was === now) return [];

    const lateness =
      field === 'maxLateness' && was !== undefined && now !== undefined
        ? Math.sign(durationSeconds(now)! - durationSeconds(was)!)
        : undefined;

    if (lateness === 0) return [];

    const finding = (severity: DriftSeverity, message: string): DriftFinding[] => [
      {
        domain: curr.frontmatter.domain,
        eventId: curr.frontmatter.id,
        severity,
        kind: 'delivery_changed',
        message,
        consumers: severity === 'breaking' ? consumers : [],
        source: sourceOf(curr),
      },
    ];

    if (was === undefined) return finding('additive', `${label} added: ${now}`);

    if (now === undefined)
      return finding(
        'breaking',
        `${label} removed${removed ? `${removed} ${was}` : ` (was ${was})`}`,
      );

    // A shorter window keeps every promise the longer one made.
    if (lateness !== undefined)
      return lateness > 0
        ? finding('breaking', `${label} lengthened: ${was} → ${now}`)
        : finding('additive', `${label} shortened: ${was} → ${now}`);

    return finding('breaking', `${label} changed: ${was} → ${now}`);
  });
}

/**
 * Compare two on-disk catalogs (baseline vs current) and classify every
 * contract change by who it can break. The baseline is typically the catalog
 * generated from your default branch; current is this working tree's.
 */
export interface DriftCatalogsOptions {
  /**
   * Consumers an event has beyond the ones its own frontmatter names, such as
   * agents that declare they consume it in a catalog of their own.
   */
  consumersOf?: (domain: string, id: string) => string[];
  /** Payload paths those extra consumers declare they read, by consumer name. */
  consumerFieldsOf?: (domain: string, id: string) => Record<string, string[]>;
  /**
   * The current source tree. When set, findings on JSON Schema contracts carry
   * the line of the field they are about, so annotations land on it.
   */
  sourceRoot?: string;
  /**
   * Runtime evidence to check the current catalog against: what ran but is not
   * documented, which fields payloads carry that the schema does not declare,
   * and what is documented but was not seen.
   */
  snapshot?: ArchitectureSnapshot;
}

/** A consumer only a runtime snapshot names, and how it is shown. */
interface RuntimeConsumer {
  name: string;
  label: string;
}

/**
 * The consumers a runtime snapshot recorded for each event, by `domain/id`. A
 * consumer seen receiving the event is evidence; one named in message metadata
 * is a report, and the label says which, since neither is a declaration.
 */
function runtimeConsumers(
  events: LoadedEvent[],
  snapshot: ArchitectureSnapshot,
): Map<string, RuntimeConsumer[]> {
  const { matches } = matchSnapshot(events, (event) => event.frontmatter, snapshot);
  const consumers = new Map<string, RuntimeConsumer[]>();

  for (const [name, event] of matches) {
    const observation = snapshot.events[name];
    const how = observation?.consumerEvidence === 'observed' ? 'seen' : 'reported';

    consumers.set(
      `${event.frontmatter.domain}/${event.frontmatter.id}`,
      // Runtime evidence is data from outside the repository: a name that is not
      // safe to print is counted under a safe label rather than dropped.
      (observation?.consumers ?? []).map((consumer) => {
        const name = isSafeName(consumer) ? consumer : UNSAFE_CONSUMER;

        return { name, label: `${name} (${how} at runtime)` };
      }),
    );
  }

  return consumers;
}

export async function driftCatalogs(
  baselineRoot: string,
  currentRoot: string,
  options: DriftCatalogsOptions = {},
): Promise<DriftReport> {
  const [baseline, current] = await Promise.all([
    loadCatalog(baselineRoot, { skipVersioned: true }),
    loadCatalog(currentRoot, { skipVersioned: true }),
  ]);

  const seen = options.snapshot
    ? runtimeConsumers(baseline, options.snapshot)
    : new Map<string, RuntimeConsumer[]>();

  const baseByKey = new Map(baseline.map((e) => [key(e), e]));
  const currByKey = new Map(current.map((e) => [key(e), e]));
  const findings: DriftFinding[] = [];

  for (const [k, base] of baseByKey) {
    const curr = currByKey.get(k);

    const declared = [
      ...new Set([
        ...base.frontmatter.consumers,
        ...(options.consumersOf?.(base.frontmatter.domain, base.frontmatter.id) ?? []),
      ]),
    ];

    // Consumers only the runtime knows about, labelled with how it knows.
    const consumers = [
      ...declared,
      ...(seen.get(`${base.frontmatter.domain}/${base.frontmatter.id}`) ?? []).flatMap(
        ({ name, label }) => (declared.includes(name) ? [] : [label]),
      ),
    ];

    if (!curr) {
      const removed: DriftFinding = {
        domain: base.frontmatter.domain,
        eventId: base.frontmatter.id,
        severity: 'breaking',
        kind: 'event_removed',
        message: `event was removed from the catalog`,
        consumers,
        source: sourceOf(base),
      };

      findings.push(...adviseBreaking([removed], { from: base.frontmatter.version }));
      continue;
    }

    const listed = new Set([...base.frontmatter.consumers, ...curr.frontmatter.consumers]);

    const assessed = [
      ...assessEventChange({
        domain: curr.frontmatter.domain,
        eventId: curr.frontmatter.id,
        consumers,
        // Only the current declaration counts: a consumer that stops reading a
        // field in the same change that removes it is exactly the safe removal,
        // and one whose declaration was dropped is back to unspecified.
        // Fields from elsewhere describe only consumers this event does not list,
        // before or after the change: another repository must not narrow what a
        // listed consumer reads, even in the change that drops it from the list.
        consumerFields: {
          ...Object.fromEntries(
            Object.entries(
              options.consumerFieldsOf?.(curr.frontmatter.domain, curr.frontmatter.id) ?? {},
            ).filter(([consumer]) => !listed.has(consumer)),
          ),
          ...curr.frontmatter.consumerFields,
        },
        source: sourceOf(curr),
        previous: base.schema,
        proposed: curr.schema,
      }),
      ...deliveryChanges(base, curr, consumers),
    ];

    const lineAt = await contractLines(options.sourceRoot, curr);

    const changes = adviseBreaking(assessed, {
      from: base.frontmatter.version,
      to: curr.frontmatter.version,
    }).map((change) => placeFinding(change, lineAt, findingPointer(change)));

    findings.push(...changes);

    // Delivery findings carry their own advice; this is about the payload.
    const schemaChanged = changes.some(
      (change) => change.kind !== 'delivery_changed' && change.diff?.kind !== 'description_changed',
    );

    const versionChanged = base.frontmatter.version !== curr.frontmatter.version;

    if (schemaChanged && !versionChanged) {
      const version = curr.frontmatter.version;
      const breaking = changes.some((change) => change.severity === 'breaking');
      // A version left alone breaks no one by itself. The consumers to name are
      // the ones the changes reach — none for a new optional field.
      const reached = new Set(changes.flatMap((change) => change.consumers));

      const unbumped: DriftFinding = {
        domain: curr.frontmatter.domain,
        eventId: curr.frontmatter.id,
        severity: 'suspicious',
        kind: 'version_unchanged',
        message: `schema changed but version stayed at ${version} — ${
          breaking ? `a breaking change needs a major bump to ${nextMajor(version)}` : 'bump it'
        }`,
        consumers: consumers.filter((consumer) => reached.has(consumer)),
        source: sourceOf(curr),
      };

      findings.push(placeFinding(unbumped, lineAt, ['x-autocatalog', 'version']));
    } else if (!schemaChanged && versionChanged) {
      findings.push({
        domain: curr.frontmatter.domain,
        eventId: curr.frontmatter.id,
        severity: 'info',
        kind: 'version_bumped',
        message: `version bumped ${base.frontmatter.version} → ${curr.frontmatter.version} with no schema change`,
        consumers: [],
        source: sourceOf(curr),
      });
    }

    findings.push(...architectureChanges(base, curr, consumers));
  }

  for (const [k, curr] of currByKey) {
    if (!baseByKey.has(k)) {
      findings.push({
        domain: curr.frontmatter.domain,
        eventId: curr.frontmatter.id,
        severity: 'additive',
        kind: 'event_added',
        message: `new event added to the catalog`,
        consumers: [],
        source: sourceOf(curr),
      });
    }
  }

  if (options.snapshot) findings.push(...runtimeDrift(current, options.snapshot));

  return summariseDrift(findings);
}

/**
 * The catalog checked against what the running system was seen to do. Field
 * and event existence are compared the way autotel-eventcatalog's drift does,
 * so the two tools agree on the same snapshot.
 *
 * Nothing here changes a contract anyone relies on, so none of it is breaking
 * or fails a compatibility strategy. An event or field the runtime sends but
 * the catalog never declared is suspicious: an undocumented contract a consumer
 * can come to depend on without review, and nobody would know to ask before
 * changing it. A documented event the snapshot did not see is information: one
 * window of traffic, or one test run, is not proof it is gone.
 */
export function runtimeDrift(
  current: LoadedEvent[],
  snapshot: ArchitectureSnapshot,
): DriftFinding[] {
  const { matches, undocumented } = matchSnapshot(current, (e) => e.frontmatter, snapshot);
  const window = snapshot.generatedAt ? ` (snapshot of ${snapshot.generatedAt})` : '';

  const finding = (
    event: LoadedEvent,
    severity: DriftSeverity,
    kind: DriftFinding['kind'],
    message: string,
  ): DriftFinding => ({
    domain: event.frontmatter.domain,
    eventId: event.frontmatter.id,
    severity,
    kind,
    message,
    consumers: [],
    source: sourceOf(event),
  });

  const unseen = undocumented.map((name): DriftFinding => {
    const observation = snapshot.events[name]!;
    const from = observation.producer ? ` from ${observation.producer}` : '';
    const [domain, eventId] = name.includes('/') ? name.split(/\/(.*)/) : ['', name];

    return {
      domain: domain!,
      eventId: eventId!,
      severity: 'suspicious',
      kind: 'event_undocumented',
      message: `the runtime emitted this event ${observation.observedCount} time(s)${from}, but the catalog does not document it — an undocumented contract consumers can come to depend on unreviewed. Declare a contract for it, or stop emitting it`,
      consumers: [],
    };
  });

  const fields = [...matches].flatMap(([name, event]) => {
    const declared = fieldPaths(event.schema);

    return (snapshot.events[name]!.fieldPaths ?? [])
      .filter((field) => !declared.has(field))
      .map((field) =>
        finding(
          event,
          'suspicious',
          'field_undeclared',
          `runtime payloads carry \`${field}\`, which the schema does not declare — consumers can start reading it with no contract behind it. Declare it, or stop sending it`,
        ),
      );
  });

  const seen = new Set(matches.values());

  const absent = current.flatMap((event) =>
    seen.has(event)
      ? []
      : [
          finding(
            event,
            'info',
            'event_unobserved',
            `documented, but not observed in the runtime snapshot${window}; one window is not proof it is gone`,
          ),
        ],
  );

  return [...unseen, ...fields, ...absent];
}

/**
 * Schema Registry compatibility strategies, for teams who already reason in
 * them. Orthogonal to severity: severity asks "who does this break?", a
 * strategy asks "which side is allowed to upgrade first?".
 *
 *   backward — new schema reads old data; consumers upgrade first
 *   forward  — old schema reads new data; producers upgrade first
 *   full     — both
 *   none     — no compatibility gate
 */
export type CompatibilityMode = 'backward' | 'forward' | 'full' | 'none';

/**
 * Which strategies a change violates.
 *
 * Deliberately the registry's rules, not this tool's severity model: deleting
 * an optional field is `breaking` here (a consumer reading it gets undefined)
 * yet compatible under both strategies, because a reader built from either
 * schema still parses the data. Teams asking for BACKWARD expect BACKWARD.
 */
export function compatibilityViolations(finding: DriftFinding): Array<'backward' | 'forward'> {
  if (finding.compatibility) return finding.compatibility;

  switch (finding.kind) {
    case 'event_removed':
    case 'operation_removed':
    case 'resource_removed':
    case 'command_outcome_changed':
    case 'type_changed':
      return ['backward', 'forward'];
    // A new reader rejects old data the narrower set no longer admits; an old
    // reader rejects new data of a type it never knew.
    case 'type_narrowed':
      return ['backward'];
    case 'type_widened':
      return ['forward'];
    // A format is a constraint like any other: adding one tightens, dropping
    // one loosens, and swapping one for another could be either.
    case 'format_changed':
      if (finding.diff?.constraint?.direction === 'tightened') return ['backward'];

      if (finding.diff?.constraint?.direction === 'loosened') return ['forward'];

      return ['backward', 'forward'];
    case 'required_added':
      // An old producer omits it, so a new reader rejects the old payload.
      return ['backward'];
    case 'required_removed':
      // A new producer may omit it, so an old reader rejects the new payload.
      return ['forward'];
    // Decided from the value sets, not the kind. `["a","b"] → ["b","c"]` both
    // removes and adds, so it violates both strategies; reporting it as a
    // narrowing alone let it pass a forward gate that should have caught it.
    case 'enum_narrowed':
    case 'enum_widened': {
      const violations: Array<'backward' | 'forward'> = [];
      const removed = finding.diff?.enumRemoved?.length ?? 0;
      const added = finding.diff?.enumAdded?.length ?? 0;
      const introduced = finding.diff?.enumIntroduced ?? false;

      // A new reader rejects old data that used a value no longer accepted.
      if (removed > 0 || introduced) violations.push('backward');

      // An old reader rejects new data that uses a value it never knew. When an
      // enum is introduced over an unrestricted field the old schema already
      // accepted every one of those values, so they are not new to it.
      if ((added > 0 && !introduced) || finding.diff?.enumDropped) violations.push('forward');

      return violations;
    }

    // Tightening rejects payloads the old schema accepted, so a new reader
    // cannot read old data. Loosening is the mirror. An ambiguous change —
    // a different `pattern` — could be either, and is reported as both.
    case 'constraint_tightened':
      return ['backward'];
    case 'constraint_loosened':
      return ['forward'];
    case 'constraint_changed':
      return ['backward', 'forward'];
    case 'field_removed': {
      const violations: Array<'backward' | 'forward'> = [];

      // Two independent reasons, and checking only the second lost the first:
      // a field that was required may now be absent, which an old reader
      // rejects; and unless the object is closed, it may now carry any value,
      // which an old reader also rejects.
      if (finding.diff?.wasRequired || !finding.diff?.containerClosedAfter) {
        violations.push('forward');
      }

      // If the object refuses unknown properties now, old payloads still
      // carrying the field are rejected outright.
      if (finding.diff?.containerClosedAfter) violations.push('backward');

      return violations;
    }

    case 'field_added':
      // A property schema of `false` forbids the field: old payloads carrying
      // it are now rejected, so a new reader cannot read old data.
      if (finding.diff?.propertyForbidden) return ['backward'];

      // Typing a field the old schema left free rejects old payloads that
      // carried it as something else.
      if (finding.diff?.constrainsPreviouslyFree) return ['backward'];

      // The required case is reported separately as required_added. An optional
      // field is only safe while the old schema tolerated unknown properties:
      // against `additionalProperties: false` it rejects every new payload.
      return finding.diff?.containerClosedBefore ? ['forward'] : [];
    default:
      return [];
  }
}

/** Findings that violate the chosen strategy. Empty for `none`. */
export function compatibilityBreaks(report: DriftReport, mode: CompatibilityMode): DriftFinding[] {
  if (mode === 'none') return [];
  const wanted: Array<'backward' | 'forward'> = mode === 'full' ? ['backward', 'forward'] : [mode];

  return report.findings.filter((finding) =>
    compatibilityViolations(finding).some((violated) => wanted.includes(violated)),
  );
}

/** An event the runtime emitted but no catalog documents has no domain to name. */
export const driftEventLabel = (f: DriftFinding): string =>
  f.domain ? `${f.domain}/${f.eventId}` : f.eventId;

const SEVERITY_ORDER: DriftSeverity[] = ['breaking', 'suspicious', 'additive', 'info'];

const SEVERITY_MARK: Record<DriftSeverity, string> = {
  breaking: '✖ BREAKING',
  suspicious: '⚠ suspicious',
  additive: '+ additive',
  info: 'ℹ info',
};

const markOf = (f: DriftFinding): string =>
  f.acknowledged ? `${SEVERITY_MARK[f.severity]} (acknowledged)` : SEVERITY_MARK[f.severity];

const adviceOf = (f: DriftFinding): string => (f.advice ? `. ${f.advice}` : '');

/** Which consumers said they read the field, which never said, and which it spares. */
function usageNote(f: DriftFinding): string {
  if (!f.usage) return '';

  const parts = [
    ['reads it', f.usage.reads],
    ['fields undeclared or invalid', f.usage.unspecified],
    ['not affected', f.usage.unaffected],
  ] as const;

  const said = parts.filter(([, names]) => names.length > 0);

  return ` (${said.map(([label, names]) => `${label}: ${names.join(', ')}`).join('; ')})`;
}

/** Render a drift report as markdown, grouped by event, breaking first. */
export function renderDriftMarkdown(report: DriftReport): string {
  if (report.findings.length === 0) return 'No contract drift detected.\n';

  const lines: string[] = ['# Contract drift', ''];
  const acknowledged = report.acknowledged > 0 ? ` (${report.acknowledged} acknowledged)` : '';

  lines.push(
    `**${report.breaking} breaking**${acknowledged} · ${report.suspicious} suspicious · ${report.additive} additive`,
    '',
  );

  const byEvent = new Map<string, DriftFinding[]>();

  for (const f of report.findings) {
    const k = driftEventLabel(f);
    byEvent.set(k, [...(byEvent.get(k) ?? []), f]);
  }

  for (const [eventKey, findings] of byEvent) {
    lines.push(`## ${eventKey}`, '');

    const sorted = [...findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );

    for (const f of sorted) {
      const impact = f.consumers.length > 0 ? ` — breaks consumers: ${f.consumers.join(', ')}` : '';
      lines.push(`- ${markOf(f)}: ${f.message}${impact}${usageNote(f)}${adviceOf(f)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

const ANNOTATION_LEVEL: Record<DriftSeverity, 'error' | 'warning' | 'notice'> = {
  breaking: 'error',
  suspicious: 'warning',
  additive: 'notice',
  info: 'notice',
};

// GitHub reads workflow commands line by line, so real newlines would end the
// annotation early and the delimiters would end a property value early.
const escapeData = (s: string): string =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeProp = (s: string): string => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * Render a drift report as GitHub Actions workflow commands, so breaking
 * changes land as annotations on the pull request diff rather than as text
 * buried in a job log. Findings the scanner traced back to code annotate that
 * file and line; the rest annotate the job.
 */
export function renderDriftGitHub(report: DriftReport): string {
  const sorted = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  return sorted
    .map((f) => {
      const props = [`title=${escapeProp(driftEventLabel(f))}`];

      if (f.source) {
        props.unshift(`file=${escapeProp(f.source.file)}`);

        if (f.source.line !== undefined) props.splice(1, 0, `line=${f.source.line}`);
      }

      const impact = f.consumers.length > 0 ? ` — breaks ${f.consumers.join(', ')}` : '';

      // An acknowledged break is news, not a failure: a warning keeps it on the
      // diff without reading as the reason the job went red.
      const level = f.acknowledged ? 'warning' : ANNOTATION_LEVEL[f.severity];

      return `::${level} ${props.join(',')}::${escapeData(f.message + impact + usageNote(f) + adviceOf(f))}`;
    })
    .join('\n');
}

/**
 * Order versions the way semver does: "v"/"V" prefixes and build metadata are
 * ignored (EventCatalog allows "V1", "V10"), and a prerelease sorts before its
 * release.
 */
export function compareSemverish(a: string, b: string): number {
  // Build metadata (`+build.5`) carries no precedence.
  const [coreA = '', ...preA] = a.replace(/^v/i, '').replace(/\+.*$/, '').split('-');
  const [coreB = '', ...preB] = b.replace(/^v/i, '').replace(/\+.*$/, '').split('-');
  const pa = coreA.split('.').map(Number);
  const pb = coreB.split('.').map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);

    if (d !== 0) return d;
  }

  if (preA.length === 0 || preB.length === 0) return preB.length - preA.length;

  // Numeric locale order follows semver's identifier rules.
  return preA.join('-').localeCompare(preB.join('-'), 'en', { numeric: true });
}

/**
 * Plain-language changelog between two schema versions of one event.
 * Used for the versioned/ history on event pages and `ac changelog`.
 */
export function renderVersionChangelog(input: {
  eventId: string;
  fromVersion: string;
  toVersion: string;
  fromSchema: SchemaNode;
  toSchema: SchemaNode;
}): string {
  const diffs = diffSchemas(input.fromSchema, input.toSchema);
  const lines = [`### ${input.eventId}: ${input.fromVersion} → ${input.toVersion}`, ''];

  if (diffs.length === 0) {
    lines.push('- No schema changes.');

    return lines.join('\n') + '\n';
  }

  for (const diff of diffs) {
    const { severity, kind } = classify(diff);
    lines.push(`- ${SEVERITY_MARK[severity]}: ${describe(diff, kind)}`);
  }

  return lines.join('\n') + '\n';
}
