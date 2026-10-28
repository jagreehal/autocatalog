import type { DslGraph } from '@eventcatalog/visualiser';
import type { Diagram, DiagramNode, EdgeEvidence, FlowStepData } from 'autocatalog-docs-core';
import { z } from 'zod';

export type { EdgeEvidence, FlowStepData, StepLanes } from 'autocatalog-docs-core';

/** Where a live map listens: a server-sent events URL, and the event name its frames carry. */
export interface LiveFeed {
  url: string;
  event: string;
}

/** What the visualiser island is given: the graph, and where each node links. */
export interface VisualiserGraph {
  graph: DslGraph;
  hrefs: Record<string, string>;
  /**
   * A flow's steps by node id: what the walkthrough calls each one, and the
   * lanes the map offers to group the flow by.
   */
  steps?: Record<string, FlowStepData>;
  /** How a flow's map is grouped when it opens, as its frontmatter says. */
  lanes?: Diagram['lanes'];
  /** Simpler levels of the same map: 2 without its messages, 1 its domains and systems. */
  levels?: { 1?: Pick<DslGraph, 'nodes' | 'edges'>; 2?: Pick<DslGraph, 'nodes' | 'edges'> };
  /** Node ids drawn as proposed: a design's parts the catalog does not have yet. */
  proposed?: string[];
  /** Runtime evidence by edge id, only where a snapshot covers the map. */
  evidence?: Record<string, EdgeEvidence>;
  live?: LiveFeed;
}

/**
 * The core's `normaliseEventId`: `order.placed` and `OrderPlaced` are one event,
 * so the map and the drift report agree on which edges ran.
 */
export const normaliseEventId = (id: string): string => id.toLowerCase().replace(/[._\-\s]/g, '');

/**
 * Replay: how often each edge that ran sends a marker, busiest every 0.6s,
 * quietest every 2.6s. An edge never seen gets no schedule.
 */
export function replaySchedule(
  evidence: Record<string, EdgeEvidence>,
): Array<{ id: string; interval: number }> {
  const ran = Object.entries(evidence).filter(
    ([, edge]) => edge.state !== 'unseen' && edge.count > 0,
  );

  const busiest = Math.max(1, ...ran.map(([, edge]) => edge.count));

  return ran.map(([id, edge]) => ({
    id,
    interval: Math.round(2600 - (edge.count / busiest) * 2000),
  }));
}

/** One server-sent frame: the event that fired, and who sent it when it says. */
export const liveFrame = z.object({ name: z.string(), producer: z.string().optional() });

export type LiveFrame = z.infer<typeof liveFrame>;

/**
 * The edges one live frame moves. The frame proves its event fired: its
 * producer's edge moves (every producer's when the frame names none). A
 * consumer's edge moves hollow, since a producer's frame says nothing about
 * whether the consumer received it.
 */
export function edgesForFrame(
  evidence: Record<string, EdgeEvidence>,
  { name, producer }: LiveFrame,
): Array<{ id: string; hollow: boolean }> {
  const event = normaliseEventId(name);

  return Object.entries(evidence).flatMap(([id, edge]): Array<{ id: string; hollow: boolean }> => {
    if (edge.event !== event) return [];

    if (edge.producer === undefined) return [{ id, hollow: true }];

    return !producer || producer === edge.producer ? [{ id, hollow: false }] : [];
  });
}

/** Busier is thicker, bounded so one hot edge cannot swamp the map. */
export const edgeWeight = (evidence: EdgeEvidence): number =>
  evidence.state === 'unseen'
    ? 1.25
    : Math.min(6, 1.5 + Math.log10(Math.max(evidence.count, 1)) * 2.2);

/**
 * A level 1 domain or system as the card the visualiser draws one as, which
 * edges connect to; its layout node is a container, which they do not.
 */
export function asGroupCard<N extends { id: string; type?: string | undefined; data: object }>(
  node: N,
  source: Pick<DiagramNode, 'label' | 'metadata'> | undefined,
): N {
  const group = source?.metadata.group;

  if (group !== 'domain' && group !== 'system') return node;

  const card = { id: node.id, name: source!.label, summary: source!.metadata.summary };

  return group === 'domain'
    ? { ...node, type: 'context-domain', data: { domain: card, mode: 'full', navigable: false } }
    : { ...node, type: 'system', data: { system: card, mode: 'full', navigable: false } };
}
