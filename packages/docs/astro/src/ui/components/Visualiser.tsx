/** @jsxImportSource react */
import { layoutGraph, NodeGraph } from '@eventcatalog/visualiser';
import type { DslGraph } from '@eventcatalog/visualiser';
import { type KeyboardEvent, useMemo } from 'react';

// The visualiser's legend counts and colours nodes by collection name, which
// is plural, while its layout writes the singular node type. Both names draw
// the same node, so the plural is used and the legend gets its icons.
const COLLECTIONS = new Map([
  ['event', 'events'],
  ['service', 'services'],
]);

/**
 * EventCatalog's own visualiser (MIT, @eventcatalog/visualiser) as an island:
 * its nodes, edge labels, dagre layout, zoom controls, legend and node search,
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
  /** Left to right where there is room; top to bottom in a narrow column, where a row would shrink to nothing. */
  direction?: 'LR' | 'TB';
}

export default function Visualiser({ id, label, graph, hrefs, direction = 'LR' }: Props) {
  // EventCatalog's own dagre layout, with its own spacing for a DSL graph.
  const laid = useMemo(() => {
    const { nodes, edges } = layoutGraph(graph.nodes, graph.edges, {
      rankdir: direction,
      nodesep: 60,
      ranksep: 120,
    });

    const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));

    return {
      // A node that opens a page says so to assistive technology: a link,
      // named for its resource, opened by Enter as well as a click.
      nodes: nodes.map((node) => ({
        ...node,
        type: COLLECTIONS.get(node.type ?? '') ?? node.type,
        ...(hrefs[node.id] && { ariaRole: 'link' as const, ariaLabel: labels.get(node.id) }),
      })),
      edges,
    };
  }, [graph, hrefs, direction]);

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
    <div className="h-full" role="region" aria-label={label} onKeyDown={onKeyDown}>
      <div
        id={`${id}-portal`}
        className="h-full overflow-hidden rounded-xl border bg-background"
        data-graph-portal
      />
      <NodeGraph
        id={id}
        nodes={laid.nodes}
        edges={laid.edges}
        includeKey
        showSearch={graph.options?.search ?? false}
        mode="full"
        zoomOnScroll={false}
        showFlowWalkthrough={false}
        // As EventCatalog's own pages do outside message flows: no envelope looping
        // along every edge. 4.1.5's NodeGraph drops `disableMessageAnimation`
        // rather than passing it on, so `animated` is what reaches the edges.
        animated={false}
        onNodeClick={(node) => open(node.id)}
      />
    </div>
  );
}
