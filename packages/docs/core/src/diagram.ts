import {
  isEventCatalogResource,
  isServiceCatalogResource,
  normaliseEventId,
  resourceKey,
  type CatalogResource,
  type LoadedEvent,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import type { Flow, FlowGroupBy, FlowStep } from './flows';

// The catalog as EventCatalog's visualiser draws it (MIT, @eventcatalog/visualiser):
// these shapes match its `GraphNode` and `GraphEdge`, so the site and the MCP
// view hand them over as they are, and neither rebuilds what the catalog means.

export type DiagramNodeType =
  | 'domain'
  | 'agent'
  | 'agentTool'
  | 'service'
  | 'event'
  | 'command'
  | 'query'
  | 'channel'
  | 'data'
  | 'actor'
  | 'external-system'
  | 'data-product'
  | 'step';

export type DiagramEdgeType =
  | 'sends'
  | 'receives'
  | 'publishes'
  | 'subscribes'
  | 'writes-to'
  | 'reads-from'
  | 'calls'
  | 'flow-step';

/** What a node's card shows, and how a design or level marks it. */
export type DiagramNodeMetadata = {
  summary?: string;
  version?: string;
  /** The model an agent uses, shown on its card. */
  model?: string;
  technology?: string;
  /** A design's part the catalog does not have yet. */
  proposed?: boolean;
  /** A level 1 domain or system, which the views draw as its card. */
  group?: 'domain' | 'system';
};

export interface DiagramNode {
  id: string;
  type: DiagramNodeType;
  label: string;
  metadata: DiagramNodeMetadata;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  type: DiagramEdgeType;
  label?: string;
}

/**
 * What a runtime snapshot says of one edge. `observed`: it ran. `unseen`: the
 * catalog declares it and the repository's snapshot never saw it.
 * `undocumented`: it ran and nobody declared it.
 */
export interface EdgeEvidence {
  state: 'observed' | 'unseen' | 'undocumented';
  /** Times the snapshot saw it; 0 when unseen. */
  count: number;
  /** The event the edge carries, normalised, so a live frame can find it. */
  event: string;
  /** Set on a producer's edge, so a live frame moves only the producer it names. */
  producer?: string;
}

/** The lanes a flow step's resource sits in, as the visualiser groups a flow by them. */
export interface StepLanes {
  domain?: { id: string; name: string };
  system?: { id: string; name: string };
  team?: { id: string; name: string };
  /** A person or system outside the catalog: a lane of their own. */
  external?: boolean;
}

/** What the visualiser reads from a flow step's node data. */
export interface FlowStepData {
  step: { id: string; title: string; summary?: string };
  lanes?: StepLanes;
}

/** A map of the catalog: what is drawn, and what a snapshot says of each edge. */
export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Runtime evidence by edge id, only where a snapshot covers the map. */
  evidence?: Record<string, EdgeEvidence>;
  /** A flow's steps by node id: what the walkthrough calls each one, and their lanes. */
  steps?: Record<string, FlowStepData>;
  /** How a flow's map is grouped when it opens. */
  lanes?: { by: FlowGroupBy; style: 'lanes' | 'boxes' };
}

/** What a repository's snapshot said of one event, for the map's edges. */
export interface EventRuntime {
  declaredProducers: string[];
  declaredConsumers: string[];
  /** Absent when the repository has a snapshot that never saw the event. */
  observed?: {
    count: number;
    producers: string[];
    consumers: string[];
    sources: Array<{ producer?: string | undefined; count: number }>;
  };
}

/**
 * Snapshot evidence by event, keyed `<namespace>/<id>` as the graph names the
 * event: `<repository>/<domain>` on the site, the domain alone for one
 * checkout. Only repositories with a snapshot: without one, an event nobody
 * saw is not evidence of anything, and the map draws it as it always did.
 */
export function runtimeByEvent(
  events: Array<{ repository?: string | undefined; event: LoadedEvent }>,
  /** Repositories whose snapshot was read, even one that matched nothing. */
  snapshots: string[],
): Map<string, EventRuntime> {
  const covered = new Set([
    ...snapshots,
    ...events.flatMap(({ repository, event }) =>
      event.frontmatter.observed ? [repository ?? ''] : [],
    ),
  ]);

  return new Map(
    events.flatMap(({ repository, event }): Array<[string, EventRuntime]> => {
      if (!covered.has(repository ?? '')) return [];

      const fm = event.frontmatter;
      const seen = fm.observed;

      return [
        [
          [repository, fm.domain, fm.id].filter(Boolean).join('/'),
          {
            declaredProducers: fm.producers,
            // The snapshot appends the consumers it saw; this is what was declared.
            declaredConsumers: seen?.declaredConsumers ?? fm.consumers,
            ...(seen && {
              observed: {
                count: seen.count,
                producers: seen.producers,
                consumers: seen.consumers,
                sources: seen.sources ?? [],
              },
            }),
          },
        ],
      ];
    }),
  );
}

/**
 * What the snapshot says of one producer's or consumer's edge to an event.
 * Nothing when it saw the event but named no producer: that says the event
 * ran, not which declared producer sent it, so the edge makes no claim.
 */
export function edgeEvidence(
  role: 'produces' | 'consumes',
  event: string,
  service: string,
  runtime: EventRuntime,
): EdgeEvidence | undefined {
  const seen = runtime.observed;
  const key = normaliseEventId(event);

  if (role === 'produces') {
    if (seen && seen.producers.length === 0) return undefined;

    const ran = seen?.producers.includes(service) ?? false;

    const fromSources = seen?.sources
      .filter((source) => source.producer === service)
      .reduce((sum, source) => sum + source.count, 0);

    return {
      state: !ran
        ? 'unseen'
        : runtime.declaredProducers.includes(service)
          ? 'observed'
          : 'undocumented',
      count: seen && ran ? fromSources || seen.count : 0,
      event: key,
      producer: service,
    };
  }

  const ran = seen?.consumers.includes(service) ?? false;

  return {
    state: !ran
      ? 'unseen'
      : runtime.declaredConsumers.includes(service)
        ? 'observed'
        : 'undocumented',
    count: ran ? seen!.count : 0,
    event: key,
  };
}

/** Our kinds that EventCatalog has a node for. Anything else stays off the map. */
export const DIAGRAM_NODE_TYPES = new Map<string, DiagramNodeType>([
  ['event', 'event'],
  ['command', 'command'],
  ['service', 'service'],
  ['agent', 'agent'],
  ['tool', 'agentTool'],
  ['domain', 'domain'],
  ['channel', 'channel'],
  ['queue', 'channel'],
  ['table', 'data'],
  ['collection', 'data'],
]);

/**
 * The relationships, named as the visualiser names them. A handler is drawn after the
 * command it handles, so the command reads left to right like an event.
 */
const EDGES = new Map<string, { type: DiagramEdgeType; label: string; reverse?: boolean }>([
  ['produces', { type: 'publishes', label: 'publishes' }],
  ['consumes', { type: 'subscribes', label: 'subscribed by' }],
  ['sends', { type: 'sends', label: 'sends' }],
  ['handles', { type: 'receives', label: 'handled by', reverse: true }],
  ['repliesTo', { type: 'sends', label: 'replies on' }],
  ['reads', { type: 'reads-from', label: 'reads from' }],
  ['writes', { type: 'writes-to', label: 'writes to' }],
]);

/** The visualiser draws a query as its own node; here a query is a command tagged `query`. */
const nodeType = (resource: CatalogResource): DiagramNodeType | undefined =>
  resource.ref.kind === 'command' && resource.tags.includes('query')
    ? 'query'
    : DIAGRAM_NODE_TYPES.get(resource.ref.kind);

export interface CatalogDiagramOptions {
  /** Draw only these resources, by key; every one when absent. */
  only?: Set<string>;
  /** Snapshot evidence, from `runtimeByEvent`; the map draws each edge by it. */
  runtime?: Map<string, EventRuntime>;
}

/**
 * The catalog as a map: every event, command, service, datastore, agent and
 * tool, joined by the messages and reads and writes between them, each node
 * keyed by its resource. Documents, repositories and models are listed
 * rather than drawn; a model an agent uses rides on the agent. Undefined
 * when there is nothing worth drawing.
 */
export function catalogDiagram(
  graph: ResourceGraph,
  { only, runtime }: CatalogDiagramOptions = {},
): Diagram | undefined {
  const titles = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource.title]),
  );

  const models = new Map(
    graph.relationships
      .filter((relationship) => relationship.type === 'usesModel')
      .map((relationship) => [
        resourceKey(relationship.from),
        titles.get(resourceKey(relationship.to)),
      ]),
  );

  const nodes: DiagramNode[] = graph.resources.flatMap((resource) => {
    const type = nodeType(resource);

    const id = resourceKey(resource.ref);

    if (!type || (only && !only.has(id))) return [];

    const model = models.get(id);

    return [
      {
        id,
        type,
        label: resource.title,
        metadata: {
          ...(resource.summary && { summary: resource.summary }),
          ...(model && { model }),
        },
      },
    ];
  });

  const drawn = new Set(nodes.map((node) => node.id));

  const evidence: Record<string, EdgeEvidence> = {};

  const edges = graph.relationships.flatMap((relationship): DiagramEdge[] => {
    const source = resourceKey(relationship.from);

    const target = resourceKey(relationship.to);

    if (!drawn.has(source) || !drawn.has(target)) return [];

    const known = EDGES.get(relationship.type);

    const id = `${source}->${target}:${relationship.type}`;

    if (relationship.type === 'produces' || relationship.type === 'consumes') {
      const [event, service] =
        relationship.type === 'produces'
          ? [relationship.to, relationship.from]
          : [relationship.from, relationship.to];

      // Snapshots name services; an agent of the same name is someone else.
      const seen =
        service.kind === 'service' ? runtime?.get(`${event.namespace}/${event.id}`) : undefined;

      const edge = seen && edgeEvidence(relationship.type, event.id, service.id, seen);

      if (edge) evidence[id] = edge;
    }

    return [
      {
        id,
        source: known?.reverse ? target : source,
        target: known?.reverse ? source : target,
        type: known?.type ?? 'calls',
        label: known?.label ?? relationship.type,
      },
    ];
  });

  // A producer the snapshot saw sending a drawn event, though nothing declares
  // it: drawn as such, with a node of its own when the catalog has none.
  for (const resource of graph.resources) {
    const event = resourceKey(resource.ref);

    const seen = runtime?.get(`${resource.ref.namespace}/${resource.ref.id}`);

    if (resource.ref.kind !== 'event' || !drawn.has(event) || !seen?.observed) continue;

    for (const producer of seen.observed.producers) {
      if (seen.declaredProducers.includes(producer)) continue;

      const service = resourceKey({ kind: 'service', id: producer });

      if (!drawn.has(service)) {
        drawn.add(service);
        nodes.push({ id: service, type: 'service', label: producer, metadata: {} });
      }

      const id = `${service}->${event}:produces`;

      const edge = edgeEvidence('produces', resource.ref.id, producer, seen);

      if (edge) evidence[id] = edge;
      edges.push({ id, source: service, target: event, type: 'publishes', label: 'publishes' });
    }
  }

  if (edges.length === 0) return undefined;

  return { nodes, edges, ...(Object.keys(evidence).length > 0 && { evidence }) };
}

/**
 * Who a service talks to and through what: its events, commands and
 * datastores, and the services, agents and tools on the far side of each
 * message, so a producer sees who consumes what it publishes. One hop past
 * the message.
 */
export function serviceNeighbourhood(graph: ResourceGraph, name: string): Set<string> {
  const centre = resourceKey({ kind: 'service', id: name });

  const messages = new Set(['event', 'command']);

  // Whoever sends or receives a message, as the catalog map draws them.
  const participants = new Set(['service', 'agent', 'tool']);

  const near = new Set([centre]);

  const ends = graph.relationships.map(
    (edge) => [resourceKey(edge.from), resourceKey(edge.to), edge] as const,
  );

  for (const [from, to] of ends) {
    if (from === centre) near.add(to);

    if (to === centre) near.add(from);
  }

  for (const [from, to, edge] of ends) {
    if (messages.has(edge.to.kind) && near.has(to) && participants.has(edge.from.kind)) {
      near.add(from);
    }

    if (messages.has(edge.from.kind) && near.has(from) && participants.has(edge.to.kind)) {
      near.add(to);
    }
  }

  return near;
}

/**
 * A domain's events and commands, whatever else belongs to it, and everything
 * one edge away: the services that send, handle, publish or subscribe.
 */
export function domainNeighbourhood(graph: ResourceGraph, domain: string): Set<string> {
  const members = new Set(
    graph.resources
      .filter(
        (resource) =>
          (isEventCatalogResource(resource) && resource.attributes.domain === domain) ||
          (resource.ref.kind === 'command' && resource.ref.namespace === domain),
      )
      .map((resource) => resourceKey(resource.ref)),
  );

  for (const edge of graph.relationships) {
    if (edge.type === 'belongsTo' && edge.to.kind === 'domain' && edge.to.id === domain) {
      members.add(resourceKey(edge.from));
    }
  }

  const near = new Set(members);

  for (const edge of graph.relationships) {
    const from = resourceKey(edge.from);

    const to = resourceKey(edge.to);

    if (members.has(from)) near.add(to);

    if (members.has(to)) near.add(from);
  }

  return near;
}

const STEP_TYPES: Record<FlowStep['kind'], DiagramNodeType> = {
  event: 'event',
  service: 'service',
  agent: 'agent',
  actor: 'actor',
  external: 'external-system',
  custom: 'step',
};

/**
 * The lanes a step sits in: its resource's domain, system and owning team,
 * from the catalog, under whatever the step's own `lane:` says. An event has
 * a domain and team of its own, so it sits with its owners rather than with
 * whoever sent it, and takes its sender's system. People and systems outside
 * the catalog share a lane; a step nothing places goes where the visualiser
 * puts it, in the lane of the step before it, or Unassigned.
 */
function lanesOf(
  step: FlowStep,
  resource: CatalogResource | undefined,
  /** Each agent's domain, from what it `belongsTo`. */
  agentDomains: Map<string, string>,
): StepLanes | undefined {
  const authored: StepLanes = Object.fromEntries(
    Object.entries(step.lane ?? {}).map(([lane, name]) => [lane, { id: name, name }]),
  );

  if ((step.kind === 'actor' || step.kind === 'external') && !step.lane) return { external: true };

  if (!resource) return step.lane ? authored : undefined;

  const domain = isEventCatalogResource(resource)
    ? resource.attributes.domain
    : isServiceCatalogResource(resource)
      ? [...resource.attributes.domains].sort()[0]
      : agentDomains.get(resourceKey(resource.ref));

  const system = isServiceCatalogResource(resource) ? resource.attributes.system : undefined;

  const team = resource.owner?.team;

  return {
    ...(domain && { domain: { id: domain, name: domain } }),
    ...(system && { system: { id: system.id, name: system.name ?? system.id } }),
    ...(team && { team: { id: team, name: resource.owner?.name ?? team } }),
    ...authored,
  };
}

/**
 * A flow as the visualiser draws one: each step a node keyed by its id, each
 * `next` a flow edge with its branch label, and each step's lanes for
 * grouping by domain, system or team.
 */
export function flowDiagram(
  flow: Flow,
  graph: ResourceGraph,
): Diagram & { resources: Record<string, CatalogResource> } {
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));

  const resourceOf = (ref: ResourceRef | undefined) => ref && byKey.get(resourceKey(ref));

  const agentDomains = new Map(
    graph.relationships
      .filter(({ type, to }) => type === 'belongsTo' && to.kind === 'domain')
      .map(({ from, to }) => [resourceKey(from), resourceOf(to)?.title ?? to.id]),
  );

  const resources: Record<string, CatalogResource> = {};
  const steps: Record<string, FlowStepData> = {};

  const nodes: DiagramNode[] = flow.steps.map((step) => {
    const resource = resourceOf(step.ref);
    const stepLanes = lanesOf(step, resource, agentDomains);

    if (resource) resources[step.id] = resource;

    // The walkthrough names a step by its title, whatever kind of node it is.
    steps[step.id] = {
      step: { id: step.id, title: step.title, ...(step.summary && { summary: step.summary }) },
      ...(stepLanes && { lanes: stepLanes }),
    };

    return {
      id: step.id,
      type: STEP_TYPES[step.kind],
      label: step.title,
      metadata: {
        ...(step.summary && { summary: step.summary }),
        ...(resource && isEventCatalogResource(resource) && { version: resource.ref.version }),
      },
    };
  });

  const edges: DiagramEdge[] = flow.steps.flatMap((step) =>
    step.next.map((next) => ({
      id: `${step.id}->${next.id}`,
      source: step.id,
      target: next.id,
      type: 'flow-step' as const,
      ...(next.label && { label: next.label }),
    })),
  );

  // A compensation runs only when a later step fails, so its edge says so.
  for (const step of flow.steps) {
    if (!step.compensatedBy) continue;

    edges.push({
      id: `${step.id}->${step.compensatedBy.id}:compensation`,
      source: step.id,
      target: step.compensatedBy.id,
      type: 'flow-step',
      label: step.compensatedBy.label ?? 'undone by',
    });
  }

  return { nodes, edges, steps, resources, ...(flow.lanes && { lanes: flow.lanes }) };
}
