import { resourceKey } from 'autocatalog-core';
import { designChanges, designDiagram, type Design } from 'autocatalog-docs-core';
import type { DocsCatalog } from './catalog';
import { renderNarrative } from './flows';
import type { DesignPageProps, DesignsPageProps } from './ui/pages';
import { pageOf, type CatalogGraphOptions } from './visualiser';

/** Where a design's page lives on the site, relative to its base. */
export const designPath = (design: Design) => `designs/${design.repository}/${design.id}/`;

export async function designPageProps(
  design: Design,
  catalog: Pick<DocsCatalog, 'graph'>,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): Promise<DesignPageProps> {
  const { nodes, edges, levels, proposed } = designDiagram(design);

  const resources = new Map(
    catalog.graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  // A part the catalog has links to its page, on the map and in the list.
  const hrefs: Record<string, string> = {};

  for (const part of design.resources) {
    const resource = part.ref && resources.get(resourceKey(part.ref));

    if (resource) hrefs[part.id] = pageOf(resource, base, pages);
  }

  const names = new Map(design.resources.map((part) => [part.id, part.name]));

  return {
    repository: design.repository,
    file: design.file,
    status: design.status,
    changes: designChanges(design),
    visualiser: {
      graph: { nodes, edges, options: { legend: true, search: nodes.length > 6 } },
      hrefs,
      levels,
      proposed,
    },
    resources: design.resources.map((part) => ({
      id: part.id,
      name: part.name,
      type: part.type,
      summary: part.summary,
      state: part.state,
      href: hrefs[part.id],
    })),
    relations: design.relations.map((relation) => ({
      from: names.get(relation.from) ?? relation.from,
      to: names.get(relation.to) ?? relation.to,
      kind: relation.label ?? relation.kind,
      state: relation.state,
    })),
    notes: design.notes.map((note) => ({
      text: note.text,
      on: note.resource && names.get(note.resource),
    })),
    narrativeHtml: design.body ? await renderNarrative(design.body) : null,
  };
}

export function designsPageProps(designs: Design[], base: string): DesignsPageProps {
  return {
    designs: designs.map((design) => ({
      title: design.title,
      summary: design.summary,
      repository: design.repository,
      status: design.status,
      changes: designChanges(design),
      href: `${base}${designPath(design)}`,
    })),
  };
}
