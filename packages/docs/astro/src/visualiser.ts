import type { GraphEdge, GraphNode } from '@eventcatalog/visualiser';
import {
  isEventCatalogResource,
  resourceKey,
  type CatalogResource,
  type ResourceGraph,
} from 'autocatalog-core';
import type { CatalogEvent } from './catalog';
import type { ShellLink } from './shell';
import { catalogAnchor } from './view';
import {
  normaliseEventId,
  type EdgeEvidence,
  type LiveFeed,
  type VisualiserGraph,
} from './ui/lib/visualiser';

export type { VisualiserGraph };

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
 * event. Only repositories with a snapshot: without one, an event nobody saw is
 * not evidence of anything, and the map draws it as it always did.
 */
export function runtimeByEvent(
  events: CatalogEvent[],
  snapshots: string[],
): Map<string, EventRuntime> {
  // Covered by a snapshot read with the repository, even one that matched
  // nothing, or by evidence a committed catalog already carries.
  const covered = new Set([
    ...snapshots,
    ...events.flatMap(({ repository, event }) => (event.frontmatter.observed ? [repository] : [])),
  ]);

  return new Map(
    events.flatMap(({ repository, event }): Array<[string, EventRuntime]> => {
      if (!covered.has(repository)) return [];

      const fm = event.frontmatter;
      const seen = fm.observed;

      return [
        [
          `${repository}/${fm.domain}/${fm.id}`,
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
const NODE_TYPES = new Map<string, GraphNode['type']>([
  ['event', 'event'],
  ['command', 'command'],
  ['service', 'service'],
  ['agent', 'agent'],
  ['tool', 'agentTool'],
  ['domain', 'domain'],
  ['channel', 'channel'],
  ['table', 'data'],
  ['collection', 'data'],
]);

/**
 * The relationships, named as the visualiser names them. A handler is drawn after the
 * command it handles, so the command reads left to right like an event.
 */
const EDGES = new Map<string, { type: GraphEdge['type']; label: string; reverse?: boolean }>([
  ['produces', { type: 'publishes', label: 'publishes' }],
  ['consumes', { type: 'subscribes', label: 'subscribed by' }],
  ['sends', { type: 'sends', label: 'sends' }],
  ['handles', { type: 'receives', label: 'handled by', reverse: true }],
  ['reads', { type: 'reads-from', label: 'reads from' }],
  ['writes', { type: 'writes-to', label: 'writes to' }],
]);

/** The visualiser draws a query as its own node; here a query is a command tagged `query`. */
const nodeType = (resource: CatalogResource): GraphNode['type'] | undefined =>
  resource.ref.kind === 'command' && resource.tags.includes('query')
    ? 'query'
    : NODE_TYPES.get(resource.ref.kind);

type FlowNode = ShellLink & { detail?: string };

/**
 * One hop around a resource, the same three columns the static flow strip
 * draws: what feeds it, the resource, and what it feeds.
 */
export function flowGraph(
  flow: {
    from: FlowNode[];
    inbound: string;
    centre: FlowNode;
    outbound: string;
    to: FlowNode[];
  },
  /** For an event: its snapshot evidence, drawn on the service edges as the catalog map draws it. */
  runtime?: { event: string; seen: EventRuntime; live?: LiveFeed | undefined },
): VisualiserGraph | undefined {
  const hrefs: Record<string, string> = {};

  const node = (link: FlowNode, id: string): GraphNode[] => {
    const type = link.kind && NODE_TYPES.get(link.kind);

    if (!type) return [];

    if (link.href) hrefs[id] = link.href;

    const version = link.detail?.replace(/^v/, '');

    return [{ id, type, label: link.label, metadata: version ? { version } : {} }];
  };

  const [centre] = node(flow.centre, 'centre');

  if (!centre) return undefined;

  const from = flow.from.flatMap((link, i) => node(link, `from-${i}`));

  const to = flow.to.flatMap((link, i) => node(link, `to-${i}`));

  const nodes = [...from, centre, ...to];

  const edges: GraphEdge[] = [
    ...from.map((source) => edge(source.id, centre.id, flow.inbound)),
    ...to.map((target) => edge(centre.id, target.id, flow.outbound)),
  ];

  const evidence: Record<string, EdgeEvidence> = {};

  if (runtime) {
    const services = [
      ...flow.from.map((link, i) => ['produces', link, `from-${i}->centre`] as const),
      ...flow.to.map((link, i) => ['consumes', link, `centre->to-${i}`] as const),
    ];

    for (const [role, link, id] of services) {
      const edge =
        link.kind === 'service' && edgeEvidence(role, runtime.event, link.label, runtime.seen);

      if (edge) evidence[id] = edge;
    }
  }

  const evidenced = Object.keys(evidence).length > 0;

  return {
    graph: { nodes, edges, options: { legend: true, search: nodes.length > 6 } },
    hrefs,
    ...(evidenced && { evidence }),
    ...(evidenced && runtime?.live && { live: runtime.live }),
  };
}

export interface CatalogGraphOptions {
  /** Draw only these resources, by key; every one when absent. */
  only?: Set<string>;
  /** Services with a page of their own, by name. */
  servicePages?: Set<string>;
  /** Events with a page of their own, by path relative to the base. */
  eventPages?: Set<string>;
  /** Snapshot evidence, from `runtimeByEvent`; the map draws each edge by it. */
  runtime?: Map<string, EventRuntime>;
  /** A server-sent events feed the map can follow live, when there is evidence to key it to. */
  live?: LiveFeed;
}

/**
 * The catalog as a map: every event, command, service, datastore, agent and
 * tool, joined by the messages and reads and writes between them. Documents,
 * repositories and models are listed in the table rather than drawn; a model
 * an agent uses rides on the agent. Undefined when there is nothing worth
 * drawing.
 */
export function catalogGraph(
  graph: ResourceGraph,
  base: string,
  { only, servicePages, eventPages, runtime, live }: CatalogGraphOptions = {},
): VisualiserGraph | undefined {
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

  const hrefs: Record<string, string> = {};

  const nodes: GraphNode[] = graph.resources.flatMap((resource) => {
    const type = nodeType(resource);

    const id = resourceKey(resource.ref);

    if (!type || (only && !only.has(id))) return [];

    const model = models.get(id);

    hrefs[id] = pageOf(resource, base, { servicePages, eventPages });

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

  const edges = graph.relationships.flatMap((relationship): GraphEdge[] => {
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

        if (servicePages?.has(producer)) hrefs[service] = `${base}services/${producer}/`;
      }

      const id = `${service}->${event}:produces`;

      const edge = edgeEvidence('produces', resource.ref.id, producer, seen);

      if (edge) evidence[id] = edge;
      edges.push({ id, source: service, target: event, type: 'publishes', label: 'publishes' });
    }
  }

  if (edges.length === 0) return undefined;

  const evidenced = Object.keys(evidence).length > 0;

  return {
    graph: { nodes, edges, options: { legend: true, search: true } },
    hrefs,
    ...(evidenced && { evidence }),
    ...(evidenced && live && { live }),
  };
}

/** A resource's own page when it has one, else its row in the Catalog. */
function pageOf(
  resource: CatalogResource,
  base: string,
  { servicePages, eventPages }: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): string {
  const { kind, namespace, id } = resource.ref;

  if (resource.url) return `${base}${resource.url.replace(/^\//, '')}`;

  const eventPage = `events/${namespace}/${id}/`;

  if (kind === 'event' && namespace && eventPages?.has(eventPage)) return `${base}${eventPage}`;

  if (kind === 'service' && servicePages?.has(id)) return `${base}services/${id}/`;

  return `${base}catalog/#${catalogAnchor(resource.ref)}`;
}

/**
 * Who a service talks to and through what: its events, commands and
 * datastores, and the services on the far side of each message, so a
 * producer sees who consumes what it publishes. One hop past the message.
 */
export function serviceNeighbourhood(graph: ResourceGraph, name: string): Set<string> {
  const centre = resourceKey({ kind: 'service', id: name });

  const messages = new Set(['event', 'command']);

  const near = new Set([centre]);

  const ends = graph.relationships.map(
    (edge) => [resourceKey(edge.from), resourceKey(edge.to), edge] as const,
  );

  for (const [from, to] of ends) {
    if (from === centre) near.add(to);

    if (to === centre) near.add(from);
  }

  for (const [from, to, edge] of ends) {
    if (messages.has(edge.to.kind) && near.has(to) && edge.from.kind === 'service') near.add(from);

    if (messages.has(edge.from.kind) && near.has(from) && edge.to.kind === 'service') near.add(to);
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

function edge(source: string, target: string, label: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'publishes', label };
}
