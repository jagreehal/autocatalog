import type { SourceLocation } from './adapter-event';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import type { LoadedEvent } from './load';
import type { EventFrontmatter, ProvenanceValue } from './schema';

export const AUTOCATALOG_GRAPH_SPEC = 'autocatalog/graph-v1' as const;

export interface ResourceRef<Kind extends string = string> {
  kind: Kind;
  namespace?: string;
  id: string;
  version?: string;
}

export interface ResourceEvidence {
  default: ProvenanceValue;
  fields: Record<string, ProvenanceValue>;
}

export interface TypedCatalogResource<Kind extends string, Attributes> {
  ref: ResourceRef<Kind>;
  title: string;
  summary?: string;
  url?: string;
  owner?: { team: string; name?: string; contact?: string };
  tags: string[];
  provenance: ResourceEvidence;
  confidence?: number;
  needsReview: boolean;
  source?: SourceLocation;
  attributes: Attributes;
  evidence?: RuntimeResourceEvidence;
}

export interface RuntimeResourceEvidence {
  count: number;
  firstSeen?: string;
  lastSeen?: string;
  sampleTraceIds: string[];
  environment?: string;
  operations?: string[];
  coverage: 'unknown';
  /** Span counts per trace export digest, so re-importing an export cannot double count. */
  exports?: { id: string; count: number }[];
}

export type ArchitectureResourceKind = 'collection' | 'table' | 'command' | 'queue' | 'endpoint';

export type ArchitectureCatalogResource = TypedCatalogResource<
  ArchitectureResourceKind,
  JsonObject
>;

export function isArchitectureCatalogResource(
  resource: CatalogResource,
): resource is ArchitectureCatalogResource {
  return ['collection', 'table', 'command', 'queue', 'endpoint'].includes(resource.ref.kind);
}

export interface EventResourceAttributes {
  domain: string;
  status: EventFrontmatter['status'];
  schema: string;
  examples: number;
  deprecation?: EventFrontmatter['deprecation'];
  payloadSchema?: JsonObject;
  nativeSchema?: string;
  schemaFormat?: string;
  registry?: JsonObject;
  envelope?: JsonObject;
}

export interface ServiceResourceAttributes {
  domains: string[];
  /** Where its code lives: a web address, as a reader would follow it. */
  repository?: string;
  /** The system it is part of, as EventCatalog groups services. */
  system?: { id: string; name?: string };
}

export interface DocumentResourceAttributes {
  repository: string;
  updated: string | null;
  /** The document's kind, such as `adr`, when it is one the organisation keeps. */
  kind?: string;
  /** Its kind's status field, such as `accepted`. */
  status?: string;
  /** Its kind's date field, as written. */
  date?: string;
}

export type RepositoryResourceAttributes = Record<string, never>;

export type AgentSystemResourceKind =
  'agent' | 'domain' | 'eval' | 'model' | 'policy' | 'tool' | 'workflow';

export type AgentSystemResourceAttributes = JsonObject;

export type EventCatalogResource = TypedCatalogResource<'event', EventResourceAttributes>;

export type ServiceCatalogResource = TypedCatalogResource<'service', ServiceResourceAttributes>;

export type DocumentCatalogResource = TypedCatalogResource<'document', DocumentResourceAttributes>;

export type RepositoryCatalogResource = TypedCatalogResource<
  'repository',
  RepositoryResourceAttributes
>;

export type AgentSystemCatalogResource = TypedCatalogResource<
  AgentSystemResourceKind,
  AgentSystemResourceAttributes
>;

export type CatalogResource =
  | ArchitectureCatalogResource
  | AgentSystemCatalogResource
  | DocumentCatalogResource
  | EventCatalogResource
  | RepositoryCatalogResource
  | ServiceCatalogResource;

export function isEventCatalogResource(
  resource: CatalogResource,
): resource is EventCatalogResource {
  return resource.ref.kind === 'event';
}

export function isServiceCatalogResource(
  resource: CatalogResource,
): resource is ServiceCatalogResource {
  return resource.ref.kind === 'service';
}

export function isDocumentCatalogResource(
  resource: CatalogResource,
): resource is DocumentCatalogResource {
  return resource.ref.kind === 'document';
}

export function isRepositoryCatalogResource(
  resource: CatalogResource,
): resource is RepositoryCatalogResource {
  return resource.ref.kind === 'repository';
}

const AGENT_SYSTEM_RESOURCE_KINDS = new Set<string>([
  'agent',
  'domain',
  'eval',
  'model',
  'policy',
  'tool',
  'workflow',
]);

export function isAgentSystemCatalogResource(
  resource: CatalogResource,
): resource is AgentSystemCatalogResource {
  return AGENT_SYSTEM_RESOURCE_KINDS.has(resource.ref.kind);
}

export type CatalogRelationshipType =
  | 'reads'
  | 'writes'
  | 'sends'
  | 'handles'
  | 'calls'
  | 'belongsTo'
  | 'consumes'
  | 'defines'
  | 'describes'
  | 'evaluates'
  | 'governedBy'
  | 'orchestrates'
  | 'produces'
  | 'publishes'
  | 'references'
  | 'relatesTo'
  | 'usesModel'
  | 'usesTool';

export interface CatalogRelationship<Type extends string = CatalogRelationshipType> {
  type: Type;
  from: ResourceRef;
  to: ResourceRef;
  provenance: ProvenanceValue;
  confidence?: number;
  needsReview: boolean;
  source?: SourceLocation;
  evidence?: RuntimeResourceEvidence;
  attributes?: JsonObject;
}

export interface ResourceGraph {
  spec: typeof AUTOCATALOG_GRAPH_SPEC;
  resources: CatalogResource[];
  relationships: CatalogRelationship[];
}

export interface ResourceGraphSummary {
  resources: number;
  resourcesByKind: Record<string, number>;
  relationships: number;
  relationshipsByType: Record<string, number>;
  provenance: Record<ProvenanceValue, number>;
  needsReview: number;
}

const encodeRefPart = (value: string) => encodeURIComponent(value);

/** Stable, collision-safe identity for Maps, artifacts, and external consumers. */
export function resourceKey(ref: ResourceRef): string {
  const namespace = ref.namespace ? `${encodeRefPart(ref.namespace)}/` : '';
  const version = ref.version ? `@${encodeRefPart(ref.version)}` : '';

  return `${encodeRefPart(ref.kind)}:${namespace}${encodeRefPart(ref.id)}${version}`;
}

export function relationshipKey(relationship: CatalogRelationship): string {
  return `${resourceKey(relationship.from)}--${encodeRefPart(relationship.type)}-->${resourceKey(relationship.to)}`;
}

export class ResourceGraphConflictError extends Error {
  constructor(
    readonly entry: 'resource' | 'relationship',
    readonly key: string,
  ) {
    super(`conflicting ${entry} '${key}' while composing resource graphs`);
    this.name = 'ResourceGraphConflictError';
  }
}

/**
 * Compose Adapter fragments into one deterministic graph without allowing a
 * later Adapter to silently replace an earlier fact.
 */
export function composeResourceGraphs(...fragments: ResourceGraph[]): ResourceGraph {
  const composer = createResourceGraphComposer();

  for (const fragment of fragments) composer.add(fragment);

  return composer.graph();
}

export interface ResourceGraphComposer {
  /**
   * Add every fact in the fragment, or none: a fragment contradicting what was
   * already added throws `ResourceGraphConflictError` and leaves the graph as it
   * was, so a caller can quarantine that one fragment and keep composing.
   */
  add(fragment: ResourceGraph): void;
  graph(): ResourceGraph;
}

export function createResourceGraphComposer(): ResourceGraphComposer {
  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();

  return {
    add(fragment) {
      const stagedResources = new Map<string, CatalogResource>();
      const stagedRelationships = new Map<string, CatalogRelationship>();

      for (const resource of fragment.resources) {
        const key = resourceKey(resource.ref);
        const existing = stagedResources.get(key) ?? resources.get(key);

        if (existing) {
          const merged = mergeCompatibleResource(existing, resource);

          if (!merged) throw new ResourceGraphConflictError('resource', key);
          stagedResources.set(key, merged);
        } else {
          stagedResources.set(key, resource);
        }
      }

      for (const relationship of fragment.relationships) {
        const key = relationshipKey(relationship);
        const existing = stagedRelationships.get(key) ?? relationships.get(key);

        if (existing && stableValue(existing) !== stableValue(relationship)) {
          throw new ResourceGraphConflictError('relationship', key);
        }

        stagedRelationships.set(key, relationship);
      }

      for (const [key, resource] of stagedResources) resources.set(key, resource);

      for (const [key, relationship] of stagedRelationships) relationships.set(key, relationship);
    },
    graph() {
      return {
        spec: AUTOCATALOG_GRAPH_SPEC,
        resources: [...resources.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, value]) => value),
        relationships: [...relationships.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, value]) => value),
      };
    },
  };
}

function mergeCompatibleResource(
  existing: CatalogResource,
  incoming: CatalogResource,
): CatalogResource | null {
  if (stableValue(existing) === stableValue(incoming)) return existing;

  if (!isServiceCatalogResource(existing) || !isServiceCatalogResource(incoming)) return null;

  const structural = (resource: ServiceCatalogResource) => ({
    ref: resource.ref,
    title: resource.title,
    summary: resource.summary,
    url: resource.url,
    owner: resource.owner,
    tags: resource.tags,
    provenance: resource.provenance,
  });

  if (stableValue(structural(existing)) !== stableValue(structural(incoming))) return null;

  const sources = [existing.source, incoming.source].filter(
    (source): source is SourceLocation => source !== undefined,
  );

  sources.sort((a, b) => stableValue(a).localeCompare(stableValue(b)));

  return {
    ...existing,
    confidence:
      existing.confidence == null && incoming.confidence == null
        ? undefined
        : Math.max(existing.confidence ?? 0, incoming.confidence ?? 0),
    needsReview: existing.needsReview || incoming.needsReview,
    source: sources[0],
    attributes: {
      domains: [
        ...new Set([...existing.attributes.domains, ...incoming.attributes.domains]),
      ].sort(),
    },
  };
}

/** JSON with object keys sorted, so equal values serialise identically whatever their key order. */
function stableValue(
  value: CatalogResource | CatalogRelationship | SourceLocation | Partial<ServiceCatalogResource>,
): string {
  return JSON.stringify(value, (_key, item: JsonValue | undefined) =>
    isJsonObject(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/**
 * An event id is unique inside one catalog's domain, not across a company, so
 * when the repository is known it is part of the identity: two repositories
 * publishing the same domain, id and version are two events, never one.
 */
function eventRef(event: LoadedEvent, repository?: string): ResourceRef<'event'> {
  const domain = event.frontmatter.domain;

  return {
    kind: 'event',
    namespace: repository ? `${repository}/${domain}` : domain,
    id: event.frontmatter.id,
    version: event.frontmatter.version,
  };
}

function serviceRef(name: string): ResourceRef<'service'> {
  return { kind: 'service', id: name };
}

export function createRepositoryResource(repository: string): RepositoryCatalogResource {
  return {
    ref: { kind: 'repository', id: repository },
    title: repository,
    summary: 'Repository inferred from the catalog layout.',
    tags: [],
    provenance: { default: 'inferred', fields: {} },
    needsReview: false,
    attributes: {},
  };
}

function sourceOf(event: LoadedEvent): SourceLocation | undefined {
  return event.frontmatter.source;
}

function fieldProvenance(event: LoadedEvent, field: string): ProvenanceValue {
  return event.frontmatter.provenance.fields[field] ?? event.frontmatter.provenance.default;
}

/**
 * Compile loaded Event contracts into the first shared resource graph.
 * Historical Event folders remain available to Event pages but do not appear
 * in the current architecture graph.
 */
export interface CreateEventResourceGraphOptions {
  /** Repository containing this Event catalog, when known from its filesystem context. */
  repository?: string;
  /** Include Event and Service routes when the consuming site renders those pages. */
  urls?: boolean;
}

export function createEventResourceGraph(
  events: LoadedEvent[],
  options: CreateEventResourceGraphOptions = {},
): ResourceGraph {
  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();

  const serviceFacts = new Map<
    string,
    {
      domains: Set<string>;
      confidence?: number;
      needsReview: boolean;
      source?: SourceLocation;
    }
  >();

  const currentEvents = events
    .filter((event) => !event.folder.isVersioned)
    .sort((a, b) => resourceKey(eventRef(a)).localeCompare(resourceKey(eventRef(b))));

  const refOf = (event: LoadedEvent) => eventRef(event, options.repository);

  const observeService = (name: string, event: LoadedEvent) => {
    const existing = serviceFacts.get(name) ?? {
      domains: new Set<string>(),
      needsReview: false,
    };

    existing.domains.add(event.frontmatter.domain);
    existing.needsReview ||= event.frontmatter.needsReview;

    if (event.frontmatter.confidence != null) {
      existing.confidence = Math.max(existing.confidence ?? 0, event.frontmatter.confidence);
    }

    const source = sourceOf(event);

    if (
      source &&
      (!existing.source ||
        `${source.file ?? ''}:${source.line ?? 0}`.localeCompare(
          `${existing.source.file ?? ''}:${existing.source.line ?? 0}`,
        ) < 0)
    ) {
      existing.source = source;
    }

    serviceFacts.set(name, existing);
  };

  const addRelationship = (
    type: 'produces' | 'consumes',
    from: ResourceRef,
    to: ResourceRef,
    event: LoadedEvent,
    field: 'producers' | 'consumers',
  ) => {
    const relationship: CatalogRelationship = {
      type,
      from,
      to,
      provenance: fieldProvenance(event, field),
      confidence: event.frontmatter.confidence,
      needsReview: event.frontmatter.needsReview,
      source: sourceOf(event),
    };

    relationships.set(relationshipKey(relationship), relationship);
  };

  for (const event of currentEvents) {
    const fm = event.frontmatter;
    const ref = refOf(event);

    const resource: EventCatalogResource = {
      ref,
      title: fm.name,
      summary: fm.summary,
      url:
        options.urls === false
          ? undefined
          : `/events/${encodeURIComponent(fm.domain)}/${encodeURIComponent(fm.id)}`,
      owner: fm.owner,
      tags: [...fm.tags].sort(),
      provenance: {
        default: fm.provenance.default,
        fields: Object.fromEntries(
          Object.entries(fm.provenance.fields).sort(([a], [b]) => a.localeCompare(b)),
        ),
      },
      confidence: fm.confidence,
      needsReview: fm.needsReview,
      source: sourceOf(event),
      attributes: {
        domain: fm.domain,
        status: fm.status,
        schema: fm.schema,
        examples: event.examples.length,
        deprecation: fm.deprecation,
        envelope: fm.envelope,
      },
    };

    resources.set(resourceKey(ref), resource);

    if (options.repository) {
      const repository = createRepositoryResource(options.repository);
      resources.set(resourceKey(repository.ref), repository);

      const defines: CatalogRelationship<'defines'> = {
        type: 'defines',
        from: repository.ref,
        to: ref,
        provenance: 'inferred',
        needsReview: false,
        source: sourceOf(event),
      };

      relationships.set(relationshipKey(defines), defines);
    }

    for (const producer of [...new Set(fm.producers)].sort()) {
      observeService(producer, event);
      addRelationship('produces', serviceRef(producer), ref, event, 'producers');
    }

    for (const consumer of [...new Set(fm.consumers)].sort()) {
      observeService(consumer, event);
      addRelationship('consumes', ref, serviceRef(consumer), event, 'consumers');
    }
  }

  for (const [name, facts] of [...serviceFacts].sort(([a], [b]) => a.localeCompare(b))) {
    const ref = serviceRef(name);

    const resource: ServiceCatalogResource = {
      ref,
      title: name,
      summary: `Service inferred from Event producer and consumer declarations.`,
      url: options.urls === false ? undefined : `/services/${encodeURIComponent(name)}`,
      tags: [],
      provenance: { default: 'inferred', fields: {} },
      confidence: facts.confidence,
      needsReview: facts.needsReview,
      source: facts.source,
      attributes: { domains: [...facts.domains].sort() },
    };

    resources.set(resourceKey(ref), resource);
  }

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...resources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value),
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value),
  };
}

export function summarizeResourceGraph(graph: ResourceGraph): ResourceGraphSummary {
  const resourcesByKind: Record<string, number> = {};
  const relationshipsByType: Record<string, number> = {};

  const provenance: Record<ProvenanceValue, number> = {
    declared: 0,
    extracted: 0,
    inferred: 0,
    overridden: 0,
    observed: 0,
  };

  let needsReview = 0;

  for (const resource of graph.resources) {
    resourcesByKind[resource.ref.kind] = (resourcesByKind[resource.ref.kind] ?? 0) + 1;
    provenance[resource.provenance.default]++;

    if (resource.needsReview) needsReview++;
  }

  for (const relationship of graph.relationships) {
    relationshipsByType[relationship.type] = (relationshipsByType[relationship.type] ?? 0) + 1;
    provenance[relationship.provenance]++;

    if (relationship.needsReview) needsReview++;
  }

  return {
    resources: graph.resources.length,
    resourcesByKind: Object.fromEntries(
      Object.entries(resourcesByKind).sort(([a], [b]) => a.localeCompare(b)),
    ),
    relationships: graph.relationships.length,
    relationshipsByType: Object.fromEntries(
      Object.entries(relationshipsByType).sort(([a], [b]) => a.localeCompare(b)),
    ),
    provenance,
    needsReview,
  };
}
