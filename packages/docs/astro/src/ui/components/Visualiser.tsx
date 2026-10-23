/** @jsxImportSource react */
import { layoutGraph, NodeGraph } from '@eventcatalog/visualiser';
import type { DslGraph } from '@eventcatalog/visualiser';
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '#ui/components/ui/toggle-group.tsx';
import {
  edgesForFrame,
  edgeWeight,
  liveFrame,
  replaySchedule,
  type EdgeEvidence,
  type LiveFeed,
  type FlowStepData,
} from '#ui/lib/visualiser.ts';

// The visualiser's legend counts and colours nodes by collection name, which
// is plural, while its layout writes the singular node type. Both names draw
// the same node, so the plural is used and the legend gets its icons.
const COLLECTIONS = new Map([
  ['event', 'events'],
  ['service', 'services'],
  ['command', 'commands'],
  ['query', 'queries'],
]);

/**
 * EventCatalog's own visualiser (MIT, @eventcatalog/visualiser) as an island:
 * its nodes, edge labels, ELK layout, zoom controls, legend and node search,
 * fed from the autocatalog graph. Graph keeps a static flow in <noscript>
 * for a reader without JavaScript.
 */
interface Props {
  id: string;
  /** Names the map for a screen reader: "Message flow". */
  label: string;
  graph: DslGraph;
  /** Where clicking a node goes, by node id. A node without one stays put. */
  hrefs: Record<string, string>;
  /** Runtime evidence by edge id: how each edge is drawn, and what can move. */
  evidence?: Record<string, EdgeEvidence> | undefined;
  /** A server-sent events feed, offered as the live mode. */
  live?: LiveFeed | undefined;
  /** A flow's steps by node id: their titles for the walkthrough, and their lanes. */
  steps?: Record<string, FlowStepData> | undefined;
}

const MODES = ['static', 'replay', 'live'] as const;

type Mode = (typeof MODES)[number];

const SVG = 'http://www.w3.org/2000/svg';

/**
 * One marker across one drawn edge. With reduced motion nothing travels: the
 * edge brightens for a moment instead.
 */
function send(root: HTMLElement, id: string, hollow: boolean, reduced: boolean): void {
  const edge = root.querySelector(`.react-flow__edge[data-id="${CSS.escape(id)}"]`);

  const path = edge?.querySelector('path.react-flow__edge-path');

  if (!edge || !(path instanceof SVGPathElement)) return;

  if (reduced) {
    edge.classList.add('ac-pulse');
    setTimeout(() => edge.classList.remove('ac-pulse'), 620);

    return;
  }

  const marker = document.createElementNS(SVG, 'circle');

  // EventCatalog's own message marker is this size; the map is usually zoomed out.
  marker.setAttribute('r', '7');
  marker.setAttribute('class', hollow ? 'ac-marker ac-marker-hollow' : 'ac-marker');
  edge.append(marker);

  const length = path.getTotalLength();

  const started = performance.now();

  const step = (now: number) => {
    const t = Math.min(1, (now - started) / 950);

    const point = path.getPointAtLength(t * length);

    marker.setAttribute('cx', String(point.x));
    marker.setAttribute('cy', String(point.y));

    if (t < 1) requestAnimationFrame(step);
    else marker.remove();
  };

  requestAnimationFrame(step);
}

const KEY: Array<[EdgeEvidence['state'], string]> = [
  ['observed', 'Ran in the snapshot; thicker is busier'],
  ['unseen', 'Declared, never seen'],
  ['undocumented', 'Ran, not in the catalog'],
];

export default function Visualiser({ id, label, graph, hrefs, evidence, live, steps }: Props) {
  const root = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('static');

  const [status, setStatus] = useState<string>();

  const [laid, setLaid] = useState<Awaited<ReturnType<typeof layoutGraph>>>();

  // EventCatalog's own ELK layout, left to right; the map zooms to fit a narrow box.
  useEffect(() => {
    let current = true;

    const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));

    void layoutGraph(graph.nodes, graph.edges).then(({ nodes, edges }) => {
      if (!current) return;

      setLaid({
        // A node that opens a page says so to assistive technology: a link,
        // named for its resource, opened by Enter as well as a click.
        nodes: nodes.map((node) => ({
          ...node,
          ...(steps?.[node.id] && { data: { ...node.data, ...steps[node.id] } }),
          type: COLLECTIONS.get(node.type ?? '') ?? node.type,
          ...(hrefs[node.id] && { ariaRole: 'link' as const, ariaLabel: labels.get(node.id) }),
        })),
        // What the snapshot says of an edge is drawn on it: weight for volume,
        // a dash for never seen, the inferred colour for undocumented.
        edges: edges.map((edge) => {
          const seen = evidence?.[edge.id];

          return seen
            ? {
                ...edge,
                className: `ac-edge-${seen.state}`,
                // SAFETY: a custom property, which CSSProperties has no key for;
                // EventCatalog's !important width leaves CSS the only way in.
                style: { ...edge.style, '--ac-edge-weight': edgeWeight(seen) } as CSSProperties,
              }
            : edge;
        }),
      });
    });

    return () => {
      current = false;
    };
  }, [graph, hrefs, evidence, steps]);

  // A process, drawn step by step: the visualiser's walkthrough follows it.
  const isFlow = graph.edges.some((edge) => edge.type === 'flow-step');

  // Replay and live move markers over the drawn edges; static moves nothing.
  useEffect(() => {
    const box = root.current;

    if (!evidence || mode === 'static' || !box) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (mode === 'replay') {
      const timers: number[] = [];

      for (const edge of replaySchedule(evidence)) {
        timers.push(
          window.setTimeout(() => {
            send(box, edge.id, false, reduced);
            timers.push(
              window.setInterval(() => send(box, edge.id, false, reduced), edge.interval),
            );
          }, Math.random() * edge.interval),
        );
      }

      // Timeout and interval ids share one pool, so one clear covers both.
      return () => timers.forEach((timer) => clearInterval(timer));
    }

    if (!live) return;

    setStatus('Connecting…');

    const source = new EventSource(live.url);

    source.addEventListener('open', () => setStatus('Live'));
    source.addEventListener('error', () => setStatus('Disconnected, retrying'));
    source.addEventListener(live.event, (message) => {
      if (!(message instanceof MessageEvent)) return;

      let data: unknown;

      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }

      // A frame from someone else's server: one that is not an event firing moves nothing.
      const frame = liveFrame.safeParse(data);

      if (!frame.success) return;

      for (const edge of edgesForFrame(evidence, frame.data)) {
        send(box, edge.id, edge.hollow, reduced);
      }
    });

    return () => {
      source.close();
      setStatus(undefined);
    };
  }, [mode, evidence, live]);

  const open = (nodeId: string | undefined) => {
    const href = nodeId === undefined ? undefined : hrefs[nodeId];

    if (href) window.location.href = href;
  };

  // React Flow makes every node focusable; Enter on one opens it, as a click does.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLElement)) return;

    open(event.target.closest<HTMLElement>('.react-flow__node')?.dataset.id);
  };

  return (
    <div
      ref={root}
      className="flex h-full flex-col gap-2"
      role="region"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {evidence && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <ToggleGroup
            aria-label="Runtime evidence"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[mode]}
            onSelectionChange={(keys) => setMode(MODES.find((next) => keys.has(next)) ?? 'static')}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem id="static">Static</ToggleGroupItem>
            <ToggleGroupItem id="replay">Replay</ToggleGroupItem>
            {live && <ToggleGroupItem id="live">Live</ToggleGroupItem>}
          </ToggleGroup>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Edge key">
            {KEY.map(([state, text]) => (
              <li key={state} className="flex items-center gap-1.5">
                <svg aria-hidden="true" width="20" height="6" className={`ac-edge-${state}`}>
                  <line x1="0" y1="3" x2="20" y2="3" />
                </svg>
                {text}
              </li>
            ))}
          </ul>
          {status && <span role="status">{status}</span>}
        </div>
      )}
      <div
        id={`${id}-portal`}
        className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background"
        data-graph-portal
      />
      {laid && (
        <NodeGraph
          id={id}
          nodes={laid.nodes}
          edges={laid.edges}
          includeKey
          showSearch={graph.options?.search ?? false}
          mode="full"
          zoomOnScroll={false}
          showFlowWalkthrough={isFlow}
          // As EventCatalog's own pages do outside message flows: no envelope
          // looping along every edge.
          disableMessageAnimation
          onNodeClick={(node) => open(node.id)}
        />
      )}
    </div>
  );
}
