import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import type { ResourceRef } from 'autocatalog-core';
import { flowDiagram, type Flow, type FlowStep } from 'autocatalog-docs-core';
import type { DocsCatalog } from './catalog';
import { remarkMermaid } from './mermaid';
import type { ResourceLinksProps } from './ui/components/ResourceLinks';
import type { VisualiserGraph } from './ui/lib/visualiser';
import type { FlowPageProps, FlowsPageProps } from './ui/pages';
import { pageOf, type CatalogGraphOptions } from './visualiser';

/** Where a flow's page lives on the site, relative to its base. */
export const flowPath = (flow: Flow) => `flows/${flow.repository}/${flow.id}/`;

/** A flow's map (see `flowDiagram`), with where each step links. */
export function flowVisualiser(
  flow: Flow,
  catalog: Pick<DocsCatalog, 'graph'>,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): VisualiserGraph {
  const { nodes, edges, steps, lanes, resources } = flowDiagram(flow, catalog.graph);

  const hrefs: Record<string, string> = {};

  for (const step of flow.steps) {
    const resource = resources[step.id];
    const href = resource ? pageOf(resource, base, pages) : step.url;

    if (href) hrefs[step.id] = href;
  }

  return {
    graph: { nodes, edges, options: { legend: true, search: nodes.length > 6 } },
    hrefs,
    ...(steps && { steps }),
    ...(lanes && { lanes }),
  };
}

// A flow's narrative is prose and diagrams: fences stay plain, and the page's
// own highlighter colours them, so Shiki is not loaded for it.
let processor: ReturnType<typeof createMarkdownProcessor> | undefined;

const narrative = () =>
  (processor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    remarkPlugins: [remarkMermaid],
  }));

/** A flow's or design's Markdown body as HTML. */
export const renderNarrative = async (body: string) =>
  (await (await narrative()).render(body)).code;

export async function flowPageProps(
  flow: Flow,
  catalog: DocsCatalog,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): Promise<FlowPageProps> {
  const visualiser = flowVisualiser(flow, catalog, base, pages);

  const titles = new Map(flow.steps.map((step) => [step.id, step.title]));

  return {
    repository: flow.repository,
    file: flow.file,
    visualiser,
    // The same steps as a list: for a reader without JavaScript, and for one
    // who would rather read the process than look at it.
    steps: flow.steps.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind,
      summary: step.summary,
      href: visualiser.hrefs[step.id],
      next: step.next.map((next) => ({ title: titles.get(next.id) ?? next.id, label: next.label })),
    })),
    narrativeHtml: flow.body ? await renderNarrative(flow.body) : null,
  };
}

export function flowsPageProps(flows: Flow[], base: string): FlowsPageProps {
  return {
    flows: flows.map((flow) => ({
      title: flow.title,
      summary: flow.summary,
      repository: flow.repository,
      steps: flow.steps.length,
      href: `${base}${flowPath(flow)}`,
    })),
  };
}

/** The flows a resource is a step in, as a card on its page; none when it is in none. */
export function flowRecords(flows: Flow[], ref: ResourceRef, base: string): ResourceLinksProps[] {
  // Any version: a page is about the resource, and a step names its current one.
  const same = (step: FlowStep) =>
    step.ref?.kind === ref.kind && step.ref.namespace === ref.namespace && step.ref.id === ref.id;

  const links = flows.flatMap((flow) =>
    flow.steps.some(same)
      ? [{ href: `${base}${flowPath(flow)}`, title: flow.title, label: flow.repository }]
      : [],
  );

  return links.length > 0 ? [{ id: 'flows', heading: 'Flows', links }] : [];
}
