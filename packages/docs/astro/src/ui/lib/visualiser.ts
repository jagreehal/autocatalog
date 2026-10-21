import type { DslGraph } from '@eventcatalog/visualiser';
import { z } from 'zod';

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

/** Where a live map listens: a server-sent events URL, and the event name its frames carry. */
export interface LiveFeed {
  url: string;
  event: string;
}

/** What the visualiser island is given: the graph, and where each node links. */
export interface VisualiserGraph {
  graph: DslGraph;
  hrefs: Record<string, string>;
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
