import type { DslGraph } from '@eventcatalog/visualiser';

/** What the visualiser island is given: the graph, and where each node links. */
export interface VisualiserGraph {
  graph: DslGraph;
  hrefs: Record<string, string>;
}
