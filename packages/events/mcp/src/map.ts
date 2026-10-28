import path from 'node:path';
import { resourceKey } from 'autocatalog-core';
import {
  catalogDiagram,
  type Design,
  type DesignInput,
  designChanges,
  designDiagram,
  domainNeighbourhood,
  flowDiagram,
  readDesigns,
  readFlows,
  resolveDesign,
  resolveAbout,
  runtimeByEvent,
  serviceNeighbourhood,
  type Diagram,
} from 'autocatalog-docs-core';
import type { CatalogSnapshot } from './tools.js';

/** What `show_map` hands its view: the diagram, and what it is a map of. */
export interface CatalogMap extends Diagram {
  title: string;
  /** The reference it was drawn around, as asked for. */
  focus?: string;
  /** A design's simpler levels: 2 without its messages, 1 its domains and systems. */
  levels?: ReturnType<typeof designDiagram>['levels'];
  /** A design's parts the catalog does not have yet. */
  proposed?: string[];
  /** What a design adds to the catalog, in a line. */
  changes?: string;
}

const repoOf = (catalog: CatalogSnapshot) => ({
  repository: path.basename(catalog.repoRoot),
  dir: catalog.repoRoot,
});

function designMap(design: Design, focus?: string): CatalogMap {
  const { nodes, edges, levels, proposed } = designDiagram(design);

  return {
    title: design.title,
    ...(focus && { focus }),
    nodes,
    edges,
    levels,
    proposed,
    changes: designChanges(design),
  };
}

/**
 * A design drawn from what an agent proposes in the conversation, checked
 * against the catalog the same way a committed `designs/<id>.md` is.
 */
export function draftMap(catalog: CatalogSnapshot, authored: DesignInput): CatalogMap {
  return designMap(
    resolveDesign(authored, catalog.mapGraph, {
      repository: repoOf(catalog).repository,
      id: 'draft',
      file: '',
    }),
  );
}

/**
 * The catalog's map, or the part of it around one resource. `focus` is a
 * reference as `about:` writes one (`service/PaymentService`,
 * `event/payments/payment.captured`, `domain/payments`), `flow/<id>` for a
 * flow this repository declares under `flows/`, or `design/<id>` for one it
 * proposes under `designs/`.
 */
export function catalogMap(catalog: CatalogSnapshot, focus?: string): CatalogMap {
  const graph = catalog.mapGraph;

  // An event a snapshot covered says so in its manifest; this checkout is the only repository.
  const runtime = runtimeByEvent(
    catalog.events.map((event) => ({ event })),
    [],
  );

  if (focus?.startsWith('design/')) {
    const id = focus.slice('design/'.length);

    const { designs, failures } = readDesigns([repoOf(catalog)], graph);

    const design = designs.find((candidate) => candidate.id === id);

    if (!design) {
      const failure = failures.find((line) => line.includes(`/designs/${id}.md:`));

      throw new Error(
        failure ??
          `No design '${id}' under designs/. Designs here: ${designs.map((d) => d.id).join(', ') || 'none'}`,
      );
    }

    return designMap(design, focus);
  }

  if (focus?.startsWith('flow/')) {
    const id = focus.slice('flow/'.length);

    const { flows, failures } = readFlows([repoOf(catalog)], graph);

    const flow = flows.find((candidate) => candidate.id === id);

    if (!flow) {
      const failure = failures.find((line) => line.includes(`/flows/${id}.md:`));

      throw new Error(
        failure ??
          `No flow '${id}' under flows/. Flows here: ${flows.map((f) => f.id).join(', ') || 'none'}`,
      );
    }

    const { resources: _, ...diagram } = flowDiagram(flow, graph);

    return { title: flow.title, focus, ...diagram };
  }

  let only: Set<string> | undefined;

  let title = 'Catalog';

  if (focus?.startsWith('domain/')) {
    const domain = focus.slice('domain/'.length);

    only = domainNeighbourhood(graph, domain);

    if (only.size === 0) {
      throw new Error(
        `No domain '${domain}'. Domains here: ${catalog.domains.join(', ') || 'none'}`,
      );
    }

    title = domain;
  } else if (focus) {
    const resolution = resolveAbout(focus, graph.resources);

    if ('failure' in resolution) throw new Error(resolution.failure);

    const key = resourceKey(resolution.ref);

    title = graph.resources.find((resource) => resourceKey(resource.ref) === key)?.title ?? focus;

    only =
      resolution.ref.kind === 'service'
        ? serviceNeighbourhood(graph, resolution.ref.id)
        : around(graph.relationships, key);
  }

  const diagram = catalogDiagram(graph, { ...(only && { only }), runtime });

  if (!diagram) throw new Error(`Nothing to draw${focus ? ` around ${focus}` : ''}: no edges.`);

  return { title, ...(focus && { focus }), ...diagram };
}

/** A resource and everything one edge away. */
function around(relationships: CatalogSnapshot['relationships'], key: string): Set<string> {
  const near = new Set([key]);

  for (const { from, to } of relationships) {
    if (resourceKey(from) === key) near.add(resourceKey(to));

    if (resourceKey(to) === key) near.add(resourceKey(from));
  }

  return near;
}

/**
 * The map in words, for the model: it answers from this while the reader
 * looks at the picture. Each edge once, with what a snapshot says of it.
 */
export function describeMap(map: CatalogMap): string {
  const labels = new Map(map.nodes.map((node) => [node.id, node.label]));

  const lines = map.edges.map((edge) => {
    const seen = map.evidence?.[edge.id];

    const evidence = seen ? ` [${seen.state}${seen.count ? `, ${seen.count} seen` : ''}]` : '';

    return `- ${labels.get(edge.source)} ${edge.label ?? edge.type} ${labels.get(edge.target)}${evidence}`;
  });

  const proposed = new Set(map.proposed);

  const parts = map.proposed
    ? `\n${map.changes}.\n${map.nodes.map((node) => `- ${node.label}: ${proposed.has(node.id) ? 'new' : 'in the catalog'}`).join('\n')}`
    : '';

  const lanes = map.lanes ? `\nGrouped by ${map.lanes.by} as ${map.lanes.style}.` : '';

  return `${map.title}: ${map.nodes.length} nodes, ${map.edges.length} edges.${lanes}${parts}\n${lines.join('\n')}`;
}
