import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import type { GraphEdge, GraphNode } from '@eventcatalog/visualiser';
import {
  isEventCatalogResource,
  isServiceCatalogResource,
  resourceKey,
  type CatalogResource,
  type ResourceRef,
} from 'autocatalog-core';
import type { Flow, FlowStep } from 'autocatalog-docs-core';
import type { DocsCatalog } from './catalog';
import { remarkMermaid } from './mermaid';
import type { ResourceLinksProps } from './ui/components/ResourceLinks';
import type { FlowStepData, StepLanes, VisualiserGraph } from './ui/lib/visualiser';
import type { FlowPageProps, FlowsPageProps } from './ui/pages';
import { pageOf, type CatalogGraphOptions } from './visualiser';

/** Where a flow's page lives on the site, relative to its base. */
export const flowPath = (flow: Flow) => `flows/${flow.repository}/${flow.id}/`;

const NODE_TYPES: Record<FlowStep['kind'], GraphNode['type']> = {
  event: 'event',
  service: 'service',
  agent: 'agent',
  actor: 'actor',
  external: 'external-system',
  custom: 'step',
};

/**
 * The lanes a step's resource sits in: its domain and its owning team, from
 * the catalog. An event has both of its own, so it sits with its owners
 * rather than with whoever sent it. People and systems outside the catalog
 * share a lane; a step the catalog says nothing about goes where the
 * visualiser puts it, in the lane of the step before it, or Unassigned.
 */
function lanesOf(
  step: FlowStep,
  resource: CatalogResource | undefined,
  /** Each agent's domain, from what it `belongsTo`. */
  agentDomains: Map<string, string>,
): StepLanes | undefined {
  if (step.kind === 'actor' || step.kind === 'external') return { external: true };

  if (!resource) return undefined;

  const domain = isEventCatalogResource(resource)
    ? resource.attributes.domain
    : isServiceCatalogResource(resource)
      ? [...resource.attributes.domains].sort()[0]
      : agentDomains.get(resourceKey(resource.ref));

  const team = resource.owner?.team;

  return {
    ...(domain && { domain: { id: domain, name: domain } }),
    ...(team && { team: { id: team, name: resource.owner?.name ?? team } }),
  };
}

/**
 * A flow as the visualiser draws one: each step a node, each `next` a flow
 * edge with its branch label, and each step's lanes for grouping by domain
 * or team.
 */
export function flowVisualiser(
  flow: Flow,
  catalog: Pick<DocsCatalog, 'graph'>,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
): VisualiserGraph {
  const resources = new Map(
    catalog.graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const resourceOf = (ref: ResourceRef | undefined) => ref && resources.get(resourceKey(ref));

  const agentDomains = new Map(
    catalog.graph.relationships
      .filter(({ type, to }) => type === 'belongsTo' && to.kind === 'domain')
      .map(({ from, to }) => [resourceKey(from), resourceOf(to)?.title ?? to.id]),
  );

  const hrefs: Record<string, string> = {};
  const steps: Record<string, FlowStepData> = {};

  const nodes: GraphNode[] = flow.steps.map((step) => {
    const resource = resourceOf(step.ref);
    const href = resource ? pageOf(resource, base, pages) : step.url;
    const stepLanes = lanesOf(step, resource, agentDomains);

    if (href) hrefs[step.id] = href;

    // The walkthrough names a step by its title, whatever kind of node it is.
    steps[step.id] = {
      step: { id: step.id, title: step.title, ...(step.summary && { summary: step.summary }) },
      ...(stepLanes && { lanes: stepLanes }),
    };

    return {
      id: step.id,
      type: NODE_TYPES[step.kind],
      label: step.title,
      metadata: {
        ...(step.summary && { summary: step.summary }),
        ...(resource && isEventCatalogResource(resource) && { version: resource.ref.version }),
      },
    };
  });

  const edges: GraphEdge[] = flow.steps.flatMap((step) =>
    step.next.map((next) => ({
      id: `${step.id}->${next.id}`,
      source: step.id,
      target: next.id,
      type: 'flow-step' as const,
      ...(next.label && { label: next.label }),
    })),
  );

  return {
    graph: { nodes, edges, options: { legend: true, search: nodes.length > 6 } },
    hrefs,
    steps,
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
    narrativeHtml: flow.body ? (await (await narrative()).render(flow.body)).code : null,
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
