import type { GraphEdge, GraphNode } from '@eventcatalog/visualiser';
import { resourceKey, type ResourceGraph } from 'autocatalog-core';
import type { ShellLink } from './shell';
import { catalogAnchor } from './view';
import type { VisualiserGraph } from './ui/lib/visualiser';

export type { VisualiserGraph };

/** Our kinds that EventCatalog has a node for. Anything else stays off the map. */
const NODE_TYPES = new Map<string, GraphNode['type']>([
  ['event', 'event'],
  ['service', 'service'],
  ['agent', 'agent'],
  ['tool', 'agentTool'],
  ['domain', 'domain'],
  ['channel', 'channel'],
]);

/** The message relationships, in EventCatalog's words. */
const EDGES = new Map<string, { type: GraphEdge['type']; label: string }>([
  ['produces', { type: 'publishes', label: 'publishes' }],
  ['consumes', { type: 'subscribes', label: 'subscribed by' }],
]);

type FlowNode = ShellLink & { detail?: string };

/**
 * One hop around a resource, the same three columns the static flow strip
 * draws: what feeds it, the resource, and what it feeds.
 */
export function flowGraph(flow: {
  from: FlowNode[];
  inbound: string;
  centre: FlowNode;
  outbound: string;
  to: FlowNode[];
}): VisualiserGraph | undefined {
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

  return { graph: { nodes, edges, options: { legend: true, search: nodes.length > 6 } }, hrefs };
}

/**
 * The whole catalog as a map: every event, service, agent and tool, joined by
 * the messages between them. Documents, repositories and models are listed
 * in the table rather than drawn; a model an agent uses rides on the agent.
 * Undefined when there is nothing worth drawing.
 */
export function catalogGraph(graph: ResourceGraph, base: string): VisualiserGraph | undefined {
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
    const type = NODE_TYPES.get(resource.ref.kind);

    if (!type) return [];

    const id = resourceKey(resource.ref);

    const model = models.get(id);

    // A resource with a page opens it; one without opens its row below.
    hrefs[id] = resource.url
      ? `${base}${resource.url.replace(/^\//, '')}`
      : `#${catalogAnchor(resource.ref)}`;

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

  const edges = graph.relationships.flatMap((relationship): GraphEdge[] => {
    const source = resourceKey(relationship.from);

    const target = resourceKey(relationship.to);

    if (!drawn.has(source) || !drawn.has(target)) return [];

    const known = EDGES.get(relationship.type);

    return [
      {
        id: `${source}->${target}:${relationship.type}`,
        source,
        target,
        type: known?.type ?? 'calls',
        label: known?.label ?? relationship.type,
      },
    ];
  });

  if (edges.length === 0) return undefined;

  return { graph: { nodes, edges, options: { legend: true, search: true } }, hrefs };
}

function edge(source: string, target: string, label: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'publishes', label };
}
