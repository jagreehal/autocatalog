import type { GraphEdge, GraphNode } from '@eventcatalog/visualiser';
import { resourceKey, type CatalogResource, type ResourceGraph } from 'autocatalog-core';
import {
  catalogDiagram,
  DIAGRAM_NODE_TYPES,
  edgeEvidence,
  type EdgeEvidence,
  type EventRuntime,
} from 'autocatalog-docs-core';
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
    const type = link.kind && DIAGRAM_NODE_TYPES.get(link.kind);

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
 * The catalog's map (see `catalogDiagram`), with where each node links: its
 * resource's page, or the page of a service only a snapshot names.
 */
export function catalogGraph(
  graph: ResourceGraph,
  base: string,
  { only, servicePages, eventPages, runtime, live }: CatalogGraphOptions = {},
): VisualiserGraph | undefined {
  const diagram = catalogDiagram(graph, { ...(only && { only }), ...(runtime && { runtime }) });

  if (!diagram) return undefined;

  const resources = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const hrefs: Record<string, string> = {};

  for (const node of diagram.nodes) {
    const resource = resources.get(node.id);

    if (resource) hrefs[node.id] = pageOf(resource, base, { servicePages, eventPages });
    else if (servicePages?.has(node.label)) hrefs[node.id] = `${base}services/${node.label}/`;
  }

  return {
    graph: { nodes: diagram.nodes, edges: diagram.edges, options: { legend: true, search: true } },
    hrefs,
    ...(diagram.evidence && { evidence: diagram.evidence }),
    ...(diagram.evidence && live && { live }),
  };
}

/** A resource's own page when it has one, else its row in the Catalog. */
export function pageOf(
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

function edge(source: string, target: string, label: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'publishes', label };
}
