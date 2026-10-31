import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assessEventChange,
  eventRuntimeEvidence,
  type EventRuntimeEvidence,
  readCatalogFreshness,
  summariseDrift,
  composeResourceGraphs,
  createCatalogProjection,
  createEventResourceGraph,
  isEventCatalogResource,
  type ResourceGraph,
  loadCatalogSnapshot as loadCatalogSnapshotCore,
  eventToLlmText,
  catalogToLlmText,
  indexFields,
  queryFields,
  hasFieldConflict,
  describeFieldConflict,
  type LoadedEvent,
  type LlmEventInput,
  type CatalogProjection,
  type CatalogFreshness,
  type DriftReport,
  type FieldSummary,
  type JsonObject,
  readCompanyIndex,
  taskContext,
  type CompanyIndexOptions,
  type TaskContext,
  type TaskContextOptions,
} from 'autocatalog-core';
import { glossaryGraph } from 'autocatalog-docs-core';
import { domainModel } from './model.js';
import {
  createAgentsResourceGraph,
  hasAgentCatalog,
  linkAgentsToEvents,
  loadCatalog as loadAgentsCatalog,
  withEventParticipants,
} from 'autocatalog-agents-core';

const execFileAsync = promisify(execFile);

/** Core stays free of child_process; the server supplies the git it needs. */
const git = async (args: string[], cwd: string): Promise<string> =>
  (await execFileAsync('git', args, { cwd })).stdout;

export interface EventSummary {
  id: string;
  version: string;
  name: string;
  summary: string;
  domain: string;
  status: string;
  producers: string[];
  consumers: string[];
  tags: string[];
  provenance: { default: string; fields: Record<string, string> };
  confidence?: number;
  needsReview: boolean;
  source?: { type?: string; file?: string; symbol?: string; line?: number };
}

function summarise(e: LoadedEvent): EventSummary {
  return {
    id: e.frontmatter.id,
    version: e.frontmatter.version,
    name: e.frontmatter.name,
    summary: e.frontmatter.summary,
    domain: e.frontmatter.domain,
    status: e.frontmatter.status,
    producers: e.frontmatter.producers,
    consumers: e.frontmatter.consumers,
    tags: e.frontmatter.tags,
    provenance: e.frontmatter.provenance,
    confidence: e.frontmatter.confidence,
    needsReview: e.frontmatter.needsReview,
    source: e.frontmatter.source,
  };
}

export interface CatalogSnapshot extends CatalogProjection {
  eventsRoot: string;
  /** The repository the events belong to: where its flows/, designs/ and agents live. */
  repoRoot: string;
  /**
   * What a map draws, as the site composes it: the events and services, and
   * the agent catalog's agents, tools and models with their own edges.
   */
  mapGraph: ResourceGraph;
  /** Why the agent catalog is not on the maps, when it does not compile. */
  mapGraphFailure?: string;
  freshness: CatalogFreshness;
}

export async function loadCatalog(
  eventsRoot: string,
  repoRoot = path.dirname(path.resolve(eventsRoot)),
): Promise<CatalogSnapshot> {
  const [snapshot, freshness] = await Promise.all([
    loadCatalogSnapshotCore(eventsRoot, { skipVersioned: true }),
    readCatalogFreshness(eventsRoot, repoRoot, git),
  ]);

  // An agent catalog beside the events names more producers and consumers. Folding
  // them in here means describe, impact, check_change and search all report them.
  const agents = await linkAgentsToEvents({
    agentsRoot: repoRoot,
    events: snapshot.events.map((e) => ({ domain: e.frontmatter.domain, id: e.frontmatter.id })),
  });

  const events = agents
    ? withEventParticipants(snapshot.events, agents.participants)
    : snapshot.events;

  const projection = createCatalogProjection({ ...snapshot, events });

  // From the events as declared: folded in, an agent would also be drawn as a service.
  const eventGraph = createEventResourceGraph(
    snapshot.events.filter((event) => !event.folder.isVersioned),
  );

  let mapGraph = eventGraph;

  let mapGraphFailure: string | undefined;

  // An agent catalog that does not compile stays off the maps, and says why,
  // rather than taking every other tool down with it.
  if (hasAgentCatalog(repoRoot)) {
    try {
      mapGraph = composeResourceGraphs(
        eventGraph,
        createAgentsResourceGraph(await loadAgentsCatalog(repoRoot), {
          urls: false,
          events: eventGraph.resources.filter(isEventCatalogResource).map((resource) => ({
            ref: resource.ref,
            domain: resource.attributes.domain,
            id: resource.ref.id,
          })),
        }),
      );
    } catch (error) {
      mapGraphFailure = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    eventsRoot,
    repoRoot: path.resolve(repoRoot),
    mapGraph,
    ...(mapGraphFailure && { mapGraphFailure }),
    freshness,
    ...projection,
  };
}

/** What the catalog is, and whether it can still be believed. */
export function catalogStatus(catalog: CatalogSnapshot) {
  return {
    eventsRoot: catalog.eventsRoot,
    events: catalog.events.length,
    domains: [...new Set(catalog.events.map((event) => event.frontmatter.domain))].sort(),
    needsReview: catalog.events.filter((event) => event.frontmatter.needsReview).length,
    freshness: catalog.freshness,
  };
}

export function resolveEvent(catalog: CatalogSnapshot, ref: string): LoadedEvent {
  const event = catalog.eventMap.get(ref);

  if (event) return event;

  const matches = catalog.currentEvents.filter((candidate) => candidate.frontmatter.id === ref);

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous event: ${ref}. Use one of: ${matches
        .map((candidate) => `${candidate.frontmatter.domain}/${ref}`)
        .sort()
        .join(', ')}`,
    );
  }

  if (matches.length === 1) return matches[0]!;

  throw new Error(`event not found: ${ref}`);
}

export function listEvents(catalog: CatalogSnapshot, domain?: string): EventSummary[] {
  const filtered = domain
    ? catalog.events.filter((e) => e.frontmatter.domain === domain)
    : catalog.events;

  return filtered.map(summarise);
}

export function describeEvent(catalog: CatalogSnapshot, ref: string) {
  const event = resolveEvent(catalog, ref);

  return {
    ...summarise(event),
    schema: event.schema,
    exampleCount: event.examples.length,
    exampleNames: event.examples.map((e) => e.name),
    body: event.body.trim() || undefined,
    folder: event.folder.path,
    runtime: eventRuntimeEvidence(event.frontmatter),
  };
}

export function getSchema(catalog: CatalogSnapshot, ref: string) {
  const event = resolveEvent(catalog, ref);

  return {
    event: `${event.frontmatter.domain}/${event.frontmatter.id}`,
    version: event.frontmatter.version,
    schema: event.schema,
  };
}

export function getExamples(catalog: CatalogSnapshot, ref: string, name?: string) {
  const event = resolveEvent(catalog, ref);
  const filtered = name ? event.examples.filter((e) => e.name === name) : event.examples;

  return {
    event: `${event.frontmatter.domain}/${event.frontmatter.id}`,
    examples: filtered.map((e) => ({ name: e.name, data: e.data })),
  };
}

export function searchEvents(catalog: CatalogSnapshot, query: string): EventSummary[] {
  const q = query.toLowerCase();

  return catalog.searchRecords
    .filter((record) => record.text.toLowerCase().includes(q))
    .map((record) => summarise(catalog.eventMap.get(`${record.domain}/${record.id}`)!));
}

export function findEventsBy(
  catalog: CatalogSnapshot,
  attribute: string,
  value: string,
): EventSummary[] {
  const results: EventSummary[] = [];

  for (const e of catalog.events) {
    const raw = Object.entries(e.frontmatter).find(([key]) => key === attribute)?.[1];

    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw) && raw.some((v) => String(v) === value)) {
      results.push(summarise(e));
    } else if (String(raw) === value) {
      results.push(summarise(e));
    }
  }

  return results;
}

function toLlmInput(event: LoadedEvent): LlmEventInput {
  return {
    id: event.frontmatter.id,
    version: event.frontmatter.version,
    name: event.frontmatter.name,
    summary: event.frontmatter.summary,
    domain: event.frontmatter.domain,
    producers: event.frontmatter.producers,
    consumers: event.frontmatter.consumers,
    schema: event.schema,
    body: event.body,
    examples: event.examples,
  };
}

export function getLlmText(catalog: CatalogSnapshot, ref?: string) {
  if (ref) {
    const event = resolveEvent(catalog, ref);

    return { text: eventToLlmText(toLlmInput(event)) };
  }

  return {
    text: catalogToLlmText(catalog.events.map(toLlmInput)),
  };
}

/**
 * What an agent should read next: status, llms-shaped text, and the site paths
 * that serve the same material (`/llms.txt`, markdown twins, catalog.json).
 */
export function askArchitecture(catalog: CatalogSnapshot, query?: string) {
  const status = catalogStatus(catalog);

  const matches = query
    ? searchEvents(catalog, query).slice(0, 8)
    : listEvents(catalog).slice(0, 8);

  return {
    status,
    site: {
      llmsTxt: '/llms.txt',
      llmsFull: '/llms-full.txt',
      catalogJson: '/catalog.json',
    },
    matches: matches.map((event) => ({
      ref: `${event.domain}/${event.id}`,
      name: event.name,
      summary: event.summary,
      needsReview: event.needsReview,
      llmText: `Pass ref "${event.domain}/${event.id}" to get_llm_text for the full markdown.`,
    })),
    text: query ? undefined : getLlmText(catalog).text,
    hint: 'Fetch /llms.txt on the site for the same index; use get_llm_text for one event.',
  };
}

/** Where `task_context` reads the company graph: the site's `/catalog.json`, as a URL or a file. */
export interface CompanySite extends CompanyIndexOptions {
  index: string;
}

/**
 * The connected context for a task. With the company site it covers every
 * repository's services, decisions and runbooks; without it, only this
 * repository's catalog, and the gaps say so.
 */
export async function taskContextFor(
  catalog: CatalogSnapshot,
  task: string,
  site?: CompanySite,
  options: TaskContextOptions = {},
): Promise<TaskContext & { catalog: { source: string; publishedAt?: string } }> {
  if (!site) {
    const context = taskContext(
      composeResourceGraphs(catalog.mapGraph, glossaryGraph(domainModel(catalog).glossaries)),
      task,
      options,
    );

    return {
      ...context,
      gaps: [
        ...context.gaps,
        "Only this repository's catalog was searched: start the server with --site <url> for the company's decisions, runbooks and other teams' services.",
      ],
      catalog: { source: catalog.repoRoot },
    };
  }

  const { graph, publishedAt } = await readCompanyIndex(site.index, site);

  return {
    ...taskContext(graph, task, options),
    catalog: { source: site.index, ...(publishedAt && { publishedAt: publishedAt.toISOString() }) },
  };
}

export function searchFieldsInCatalog(
  catalog: CatalogSnapshot,
  query?: string,
  conflictsOnly?: boolean,
): FieldSummary[] {
  return queryFields(indexFields(catalog.events), { query, conflictsOnly });
}

export interface ImpactReport {
  event: string;
  version: string;
  /** Who receives this event today, and therefore who a change reaches. */
  consumers: string[];
  producers: string[];
  /** Where the contract is defined, when the scanner traced it back to code. */
  source?: { type?: string; file?: string; symbol?: string; line?: number };
  /** Never let an agent act on a guess without knowing it is one. */
  provenance: { default: string; fields: Record<string, string> };
  confidence?: number;
  needsReview: boolean;
  /** Other events carrying the same field path, and who they reach. */
  sharedFields: Array<{
    path: string;
    conflict: string | null;
    events: Array<{ event: string; consumers: string[] }>;
  }>;
  /** Deduplicated consumers across this event and every event sharing the field. */
  notify: string[];
  /** Whether this answer still describes the working tree. */
  freshness: CatalogFreshness;
  /**
   * What the runtime was seen to do, when the catalog carries evidence.
   * `neverObserved` is the difference between the two lists — a consumer the
   * catalog claims and the evidence has never seen.
   */
  runtime?: Extract<EventRuntimeEvidence, { status: 'snapshot' }> & { lastSeen: string };
}

/**
 * Who a change to this event reaches.
 *
 * The lookup tools answer "what is in the catalog". This answers the question
 * an agent actually has before it edits a contract: who receives this, does
 * the field travel anywhere else, and is any of it a guess.
 */
export function assessImpact(catalog: CatalogSnapshot, ref: string, field?: string): ImpactReport {
  const event = resolveEvent(catalog, ref);

  const {
    id,
    version,
    domain,
    consumers,
    producers,
    source,
    provenance,
    confidence,
    needsReview,
    observed,
  } = event.frontmatter;

  const summaries = indexFields(catalog.events);

  const relevant = field
    ? summaries.filter((summary) => summary.path === field || summary.path.startsWith(`${field}.`))
    : summaries.filter((summary) =>
        summary.occurrences.some((occurrence) => occurrence.eventId === id),
      );

  const notify = new Set(consumers);

  const sharedFields = relevant
    .map((summary) => {
      const events = summary.occurrences.map((occurrence) => {
        // A field that travels through someone else's event reaches their
        // consumers too. That second hop is the part a human forgets.
        if (occurrence.eventId !== id) occurrence.consumers.forEach((c) => notify.add(c));

        return {
          event: `${occurrence.domain}/${occurrence.eventId}`,
          consumers: occurrence.consumers,
        };
      });

      return {
        path: summary.path,
        conflict: hasFieldConflict(summary) ? describeFieldConflict(summary) : null,
        events,
      };
    })
    .filter((entry) => entry.events.length > 1 || entry.conflict !== null);

  return {
    event: `${domain}/${id}`,
    version,
    consumers,
    producers,
    source,
    provenance,
    confidence,
    needsReview,
    sharedFields,
    notify: [...notify].sort(),
    freshness: catalog.freshness,
    runtime: observed
      ? { ...eventRuntimeEvidenceWithSnapshot(event.frontmatter), lastSeen: observed.lastSeen }
      : undefined,
  };
}

/**
 * What a proposed schema breaks, and who it breaks.
 *
 * Runs the same classifier the CI drift gate runs, so an agent gets the answer
 * the pull request would have given it — before it opens one.
 */
export function checkChange(
  catalog: CatalogSnapshot,
  ref: string,
  proposed: JsonObject,
): DriftReport & { event: string; notify: string[]; freshness: CatalogFreshness } {
  const event = resolveEvent(catalog, ref);
  const { id, domain, consumers, consumerFields, source } = event.frontmatter;

  const findings = assessEventChange({
    domain,
    eventId: id,
    consumers,
    consumerFields,
    source: source?.file ? { file: source.file, line: source.line } : undefined,
    previous: event.schema,
    proposed,
  });

  const report = summariseDrift(findings);

  return {
    ...report,
    event: `${domain}/${id}`,
    notify: [...new Set(findings.flatMap((finding) => finding.consumers))].sort(),
    freshness: catalog.freshness,
  };
}

function eventRuntimeEvidenceWithSnapshot(event: LoadedEvent['frontmatter']) {
  const evidence = eventRuntimeEvidence(event);

  if (evidence.status !== 'snapshot') throw new Error('Event has no snapshot evidence');

  return evidence;
}

/** A bounded handoff to a connected telemetry MCP server; performs no network I/O. */
export function investigationBundle(
  catalog: CatalogSnapshot,
  ref: string,
  field?: string,
  proposed?: JsonObject,
) {
  const event = resolveEvent(catalog, ref);
  const fm = event.frontmatter;
  const evidence = eventRuntimeEvidence(fm);
  const sampleTraceIds = evidence.status === 'snapshot' ? evidence.sampleTraceIds : [];

  return {
    spec: 'autocatalog-investigation/v1' as const,
    resource: { kind: 'event' as const, namespace: fm.domain, id: fm.id, version: fm.version },
    catalog: { eventsRoot: catalog.eventsRoot, freshness: catalog.freshness },
    owner: fm.owner,
    source: fm.source,
    impact: assessImpact(catalog, ref, field),
    change: proposed ? checkChange(catalog, ref, proposed) : undefined,
    evidence,
    telemetry: {
      server: 'autotel',
      scope: { environment: 'unknown', release: 'unknown', backend: 'unknown' },
      serviceCandidates: [
        ...new Set([
          ...fm.producers,
          ...fm.consumers,
          ...(evidence.status === 'snapshot' ? evidence.observedProducers : []),
        ]),
      ].sort(),
      mappingRequired:
        'Resolve catalog service names to backend service identities; confirm environment and release before attributing telemetry to this event.',
      preflight: [
        { tool: 'backend_health', arguments: {} },
        { tool: 'backend_capabilities', arguments: {} },
      ],
      traceQueries: sampleTraceIds.map((traceId) => ({
        tool: 'summarize_trace',
        arguments: { traceId },
        requires: ['traces'],
      })),
      correlationQueries: sampleTraceIds.map((traceId) => ({
        tool: 'correlate',
        arguments: { traceId },
        requires: ['traces'],
        guidance:
          'Inspect signal availability. Trace-linked logs support correlation; metrics from the same service/time are contextual evidence.',
      })),
      discovery: {
        tool: 'list_services',
        arguments: {},
        guidance:
          'When trace references are missing or expired, discover service identities and query a confirmed environment/time window. Do not assume a universal event attribute or metric name.',
      },
    },
  };
}
