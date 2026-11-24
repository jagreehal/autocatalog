import type { GraphEdge, GraphNode } from '@eventcatalog/visualiser';
import { isEventCatalogResource, isServiceCatalogResource, resourceKey } from 'autocatalog-core';
import type { CatalogResource, ResourceGraph } from 'autocatalog-core';
import { catalogDiagram, DIAGRAM_NODE_TYPES, edgeEvidence } from 'autocatalog-docs-core';
import type { EdgeEvidence, EventRuntime } from 'autocatalog-docs-core';
import type { ShellLink } from './shell';
import { catalogAnchor } from './view';
import type { LiveFeed, VisualiserGraph } from './ui/lib/visualiser';

export {
  domainNeighbourhood,
  edgeEvidence,
  type EventRuntime,
  runtimeByEvent,
  serviceNeighbourhood,
} from 'autocatalog-docs-core';

export type { VisualiserGraph };

type FlowNode = ShellLink & { detail?: string };

/**
 * One hop around a resource, the same three columns the static flow strip
 * draws: what feeds it, the resource, and what it feeds.
 */
export function flowGraph(
  flow: {
    from: Array<FlowNode>;
    inbound: string;
    centre: FlowNode;
    outbound: string;
    to: Array<FlowNode>;
  },
  /** For an event: its snapshot evidence, drawn on the service edges as the catalog map draws it. */
  runtime?: { event: string; seen: EventRuntime; live?: LiveFeed | undefined },
): VisualiserGraph | undefined {
  const hrefs: Record<string, string> = {};

  const node = (link: FlowNode, id: string): Array<GraphNode> => {
    const type = link.kind && DIAGRAM_NODE_TYPES.get(link.kind);

    if (!type) {
      return [];
    }

    if (link.href) {
      hrefs[id] = link.href;
    }

    const version = link.detail?.replace(/^v/, '');

    return [{ id, type, label: link.label, metadata: version ? { version } : {} }];
  };

  const [centre] = node(flow.centre, 'centre');

  if (!centre) {
    return undefined;
  }

  const from = flow.from.flatMap((link, i) => node(link, `from-${i}`));

  const to = flow.to.flatMap((link, i) => node(link, `to-${i}`));

  const nodes = [...from, centre, ...to];

  const edges: Array<GraphEdge> = [
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

      if (edge) {
        evidence[id] = edge;
      }
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
  /**
   * Add the simpler levels (2: services and data, 1: domains) and open at
   * this one. Only the whole catalog's map folds by domain.
   */
  levels?: {
    open: 1 | 2 | 3;
    /** The domains with a page; one only a message's namespace suggests is not drawn. */
    domains: ReadonlySet<string>;
    domainHref: (name: string) => string;
    domainTitle: (name: string) => string;
  };
}

/**
 * The catalog's map (see `catalogDiagram`), with where each node links: its
 * resource's page, or the page of a service only a snapshot names.
 */
export function catalogGraph(
  graph: ResourceGraph,
  base: string,
  { only, servicePages, eventPages, runtime, live, levels }: CatalogGraphOptions = {},
): VisualiserGraph | undefined {
  const diagram = catalogDiagram(graph, { ...(only && { only }), ...(runtime && { runtime }) });

  if (!diagram) {
    return undefined;
  }

  const resources = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const hrefs: Record<string, string> = {};

  for (const node of diagram.nodes) {
    const resource = resources.get(node.id);

    if (resource) {
      hrefs[node.id] = pageOf(resource, base, { servicePages, eventPages });
    } else if (servicePages?.has(node.label)) {
      hrefs[node.id] = `${base}services/${node.label}/`;
    }
  }

  const folded = levels && !only ? catalogLevels(diagram, resources, levels) : undefined;

  if (folded) {
    Object.assign(hrefs, folded.hrefs);
  }

  return {
    graph: { nodes: diagram.nodes, edges: diagram.edges, options: { legend: true, search: true } },
    hrefs,
    ...(folded && { levels: folded.levels, initialLevel: levels!.open }),
    ...(diagram.evidence && { evidence: diagram.evidence }),
    ...(diagram.evidence && live && { live }),
  };
}

const MESSAGES = new Set(['event', 'command', 'query']);

/**
 * The catalog map folded twice: level 2 keeps services and data, a message
 * between two services becoming one edge named by what it carries; level 1
 * folds those into their domains. A message's domain is its own (an event's
 * `domain`, a command's namespace); a service's is the first it names; a data
 * store's, the first service that uses it. A node with none stays off level 1.
 */
export function catalogLevels(
  diagram: { nodes: Array<GraphNode>; edges: Array<GraphEdge> },
  resources: Map<string, CatalogResource>,
  { domains: known, domainHref, domainTitle }: NonNullable<CatalogGraphOptions['levels']>,
): { levels: NonNullable<VisualiserGraph['levels']>; hrefs: Record<string, string> } | undefined {
  const types = new Map(diagram.nodes.map((node) => [node.id, node.type]));

  const ownDomain = (id: string): string | undefined => {
    const resource = resources.get(id);

    if (!resource) {
      return undefined;
    }

    if (isEventCatalogResource(resource)) {
      return resource.attributes.domain;
    }

    if (isServiceCatalogResource(resource)) {
      return resource.attributes.domains[0];
    }

    return MESSAGES.has(types.get(id) ?? '')
      ? resource.ref.namespace?.split('/').at(-1)
      : undefined;
  };

  const domainOf = new Map<string, string>();

  for (const node of diagram.nodes) {
    const domain = ownDomain(node.id);

    if (domain !== undefined && known.has(domain)) {
      domainOf.set(node.id, domain);
    }
  }

  // A data store takes the domain of the first service that reads or writes it.
  for (const edge of diagram.edges) {
    for (const [store, service] of [
      [edge.target, edge.source],
      [edge.source, edge.target],
    ] as const) {
      if (types.get(store) === 'data' && !domainOf.has(store) && domainOf.has(service)) {
        domainOf.set(store, domainOf.get(service)!);
      }
    }
  }

  const domains = [...new Set(domainOf.values())].sort();

  if (domains.length < 2) {
    return undefined;
  }

  // Level 2: producer to consumer through each message, the message folded into the edge.
  const into = new Map<string, Array<string>>();
  const outOf = new Map<string, Array<string>>();

  for (const edge of diagram.edges) {
    if (MESSAGES.has(types.get(edge.target) ?? '')) {
      into.set(edge.target, [...(into.get(edge.target) ?? []), edge.source]);
    }

    if (MESSAGES.has(types.get(edge.source) ?? '')) {
      outOf.set(edge.source, [...(outOf.get(edge.source) ?? []), edge.target]);
    }
  }

  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  const bridged = new Map<string, { source: string; target: string; labels: Set<string> }>();

  const bridge = (source: string, target: string, label: string | undefined) => {
    if (source === target) {
      return;
    }

    const key = `${source}->${target}`;
    const entry = bridged.get(key) ?? { source, target, labels: new Set<string>() };

    if (label) {
      entry.labels.add(label);
    }
    bridged.set(key, entry);
  };

  for (const [message, producers] of into) {
    for (const source of producers) {
      for (const target of outOf.get(message) ?? []) {
        bridge(source, target, labels.get(message));
      }
    }
  }

  const kept = diagram.nodes.filter((node) => !MESSAGES.has(node.type ?? ''));
  const keptIds = new Set(kept.map(({ id }) => id));

  const direct = diagram.edges.filter(
    (edge) => keptIds.has(edge.source) && keptIds.has(edge.target),
  );

  const level2Edges: Array<GraphEdge> = [
    ...direct,
    ...[...bridged].map(([id, { source, target, labels: carried }]) => ({
      id,
      source,
      target,
      type: 'calls' as const,
      label: [...carried].join(', '),
    })),
  ];

  // Level 1: every edge between two domains, once, named by what crosses it.
  // Messages by id: two with one title are still two messages crossing.
  const crossing = new Map<string, { source: string; target: string; messages: Set<string> }>();

  for (const edge of diagram.edges) {
    const source = domainOf.get(edge.source);
    const target = domainOf.get(edge.target);

    if (!source || !target || source === target) {
      continue;
    }

    const id = `domain:${source}->domain:${target}`;

    const entry = crossing.get(id) ?? {
      source: `domain:${source}`,
      target: `domain:${target}`,
      messages: new Set<string>(),
    };

    const message = MESSAGES.has(types.get(edge.source) ?? '')
      ? edge.source
      : MESSAGES.has(types.get(edge.target) ?? '')
        ? edge.target
        : undefined;

    if (message) {
      entry.messages.add(message);
    }

    crossing.set(id, entry);
  }

  const hrefs: Record<string, string> = {};

  const level1Nodes: Array<GraphNode> = domains.map((name) => {
    hrefs[`domain:${name}`] = domainHref(name);

    return {
      id: `domain:${name}`,
      type: 'step',
      label: domainTitle(name),
      metadata: { group: 'domain' },
    };
  });

  return {
    hrefs,
    levels: {
      2: { nodes: kept, edges: level2Edges },
      1: {
        nodes: level1Nodes,
        edges: [...crossing].map(([id, { source, target, messages: carried }]) => ({
          id,
          source,
          target,
          type: 'calls' as const,
          ...(carried.size > 0 && { label: plural(carried.size) }),
        })),
      },
    },
  };
}

// On a domain map an edge says how much crosses it; the messages are a click away.
const plural = (count: number) => (count === 1 ? '1 message' : `${count} messages`);

/** A resource's own page when it has one, else its row in the Catalog. */
export function pageOf(
  resource: CatalogResource,
  base: string,
  { servicePages, eventPages }: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): string {
  const { kind, namespace, id } = resource.ref;

  if (resource.url) {
    return `${base}${resource.url.replace(/^\//, '')}`;
  }

  const eventPage = `events/${namespace}/${id}/`;

  if (kind === 'event' && namespace && eventPages?.has(eventPage)) {
    return `${base}${eventPage}`;
  }

  if (kind === 'service' && servicePages?.has(id)) {
    return `${base}services/${id}/`;
  }

  return `${base}catalog/#${catalogAnchor(resource.ref)}`;
}

function edge(source: string, target: string, label: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'publishes', label };
}
