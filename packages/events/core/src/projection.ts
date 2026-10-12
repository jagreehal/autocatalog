import type { CatalogSnapshot, LoadedEvent } from './load';
import { catalogToLlmText, type LlmEventInput } from './llm';
import {
  createEventResourceGraph,
  isEventCatalogResource,
  isServiceCatalogResource,
  resourceKey,
  summarizeResourceGraph,
  type CatalogRelationship,
  type CatalogResource,
  type EventCatalogResource,
  type ResourceGraph,
  type ResourceGraphSummary,
  type ServiceCatalogResource,
} from './resource-graph';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'event' | 'service';
  domain?: string;
  url?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'produces' | 'consumes';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  domains: string[];
}

export interface ServiceSummary {
  name: string;
  domains: string[];
  produces: Array<{ id: string; name: string; domain: string }>;
  consumes: Array<{ id: string; name: string; domain: string }>;
}

export interface CatalogSearchRecord {
  id: string;
  name: string;
  version: string;
  domain: string;
  summary: string;
  tags: string[];
  url: string;
  text: string;
}

export interface CatalogProjection {
  events: LoadedEvent[];
  currentEvents: LoadedEvent[];
  resourceGraph: ResourceGraph;
  resources: CatalogResource[];
  relationships: CatalogRelationship[];
  resourceMap: Map<string, CatalogResource>;
  resourceSummary: ResourceGraphSummary;
  domains: string[];
  services: Map<string, ServiceSummary>;
  graph: GraphData;
  searchRecords: CatalogSearchRecord[];
  eventMap: Map<string, LoadedEvent>;
}

type ArchitectureResource = EventCatalogResource | ServiceCatalogResource;

function isArchitectureResource(resource: CatalogResource): resource is ArchitectureResource {
  return isEventCatalogResource(resource) || isServiceCatalogResource(resource);
}

function legacyNodeId(resource: ArchitectureResource): string {
  return isEventCatalogResource(resource)
    ? `event:${resource.ref.namespace}/${resource.ref.id}`
    : `service:${resource.ref.id}`;
}

function buildGraphFromResourceGraph(resourceGraph: ResourceGraph): GraphData {
  const architectureResources = resourceGraph.resources.filter(isArchitectureResource);

  const nodes = architectureResources.map((resource): GraphNode => ({
    id: legacyNodeId(resource),
    label: resource.title,
    kind: resource.ref.kind,
    domain: isEventCatalogResource(resource) ? resource.attributes.domain : undefined,
    url: resource.url,
  }));

  const byKey = new Map(
    architectureResources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const edges = resourceGraph.relationships.flatMap((relationship): GraphEdge[] => {
    if (relationship.type !== 'produces' && relationship.type !== 'consumes') return [];
    const from = byKey.get(resourceKey(relationship.from));
    const to = byKey.get(resourceKey(relationship.to));

    if (!from || !to) return [];

    return [{ from: legacyNodeId(from), to: legacyNodeId(to), kind: relationship.type }];
  });

  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    domains: architectureResources
      .filter(isEventCatalogResource)
      .map((resource) => resource.attributes.domain)
      .filter((domain, index, domains) => domains.indexOf(domain) === index)
      .sort(),
  };
}

/** Project a loaded event into the shape the LLM renderers take. */
export function toLlmInput(event: LoadedEvent): LlmEventInput {
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

/** The whole catalog as one markdown document an agent can read in one call. */
export function catalogSnapshotToLlmText(events: LoadedEvent[]): string {
  return catalogToLlmText(events.map(toLlmInput));
}

export function buildGraph(events: LoadedEvent[]): GraphData {
  return buildGraphFromResourceGraph(createEventResourceGraph(events));
}

function buildServicesFromResourceGraph(resourceGraph: ResourceGraph): Map<string, ServiceSummary> {
  const services = new Map<string, ServiceSummary>();

  const resources = new Map(
    resourceGraph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  for (const resource of resourceGraph.resources) {
    if (!isServiceCatalogResource(resource)) continue;
    services.set(resource.ref.id, {
      name: resource.title,
      domains: [...resource.attributes.domains],
      produces: [],
      consumes: [],
    });
  }

  for (const relationship of resourceGraph.relationships) {
    const from = resources.get(resourceKey(relationship.from));
    const to = resources.get(resourceKey(relationship.to));

    const event =
      from && isEventCatalogResource(from)
        ? from
        : to && isEventCatalogResource(to)
          ? to
          : undefined;

    const service =
      from && isServiceCatalogResource(from)
        ? from
        : to && isServiceCatalogResource(to)
          ? to
          : undefined;

    if (!event || !service) continue;
    const summary = services.get(service.ref.id);

    if (!summary) continue;
    const item = { id: event.ref.id, name: event.title, domain: event.attributes.domain };

    if (relationship.type === 'produces') summary.produces.push(item);

    if (relationship.type === 'consumes') summary.consumes.push(item);
  }

  for (const service of services.values()) {
    service.domains.sort();
    service.produces.sort((a, b) => a.id.localeCompare(b.id));
    service.consumes.sort((a, b) => a.id.localeCompare(b.id));
  }

  return new Map([...services].sort(([a], [b]) => a.localeCompare(b)));
}

export function buildServices(events: LoadedEvent[]): Map<string, ServiceSummary> {
  return buildServicesFromResourceGraph(createEventResourceGraph(events));
}

export function createCatalogProjection(input: CatalogSnapshot | LoadedEvent[]): CatalogProjection {
  const events = Array.isArray(input) ? input : input.events;
  const currentEvents = events.filter((event) => !event.folder.isVersioned);
  const resourceGraph = createEventResourceGraph(currentEvents);

  const resourceMap = new Map(
    resourceGraph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const byId = new Map<string, LoadedEvent[]>();
  const eventMap = new Map<string, LoadedEvent>();

  for (const event of currentEvents) {
    const fm = event.frontmatter;
    eventMap.set(`${fm.domain}/${fm.id}`, event);
    const matches = byId.get(fm.id) ?? [];
    matches.push(event);
    byId.set(fm.id, matches);
  }

  for (const [id, matches] of byId) {
    if (matches.length === 1) eventMap.set(id, matches[0]!);
  }

  const searchRecords = currentEvents
    .map((event) => {
      const fm = event.frontmatter;

      return {
        id: fm.id,
        name: fm.name,
        version: fm.version,
        domain: fm.domain,
        summary: fm.summary,
        tags: fm.tags,
        url: `/events/${fm.domain}/${fm.id}`,
        text: [
          fm.id,
          fm.name,
          fm.summary,
          fm.domain,
          ...fm.producers,
          ...fm.consumers,
          ...fm.tags,
          event.body,
        ].join(' '),
      };
    })
    .sort((a, b) => `${a.domain}/${a.id}`.localeCompare(`${b.domain}/${b.id}`));

  return {
    events,
    currentEvents,
    resourceGraph,
    resources: resourceGraph.resources,
    relationships: resourceGraph.relationships,
    resourceMap,
    resourceSummary: summarizeResourceGraph(resourceGraph),
    domains: [...new Set(currentEvents.map((event) => event.frontmatter.domain))].sort(),
    services: buildServicesFromResourceGraph(resourceGraph),
    graph: buildGraphFromResourceGraph(resourceGraph),
    searchRecords,
    eventMap,
  };
}
