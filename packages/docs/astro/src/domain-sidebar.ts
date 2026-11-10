import type { CatalogResource, ResourceGraph } from 'autocatalog-core';
import type { Design, Entity, Flow, Overview } from 'autocatalog-docs-core';
import { apisForService, catalogServices, type CatalogApi } from './apis';
import type { CatalogEvent } from './catalog';
import { buildDomains } from './domains';
import { eventPath } from './event-path';
import { flowPath } from './flows';
import { serviceLink, titleCase, type SidebarGroup, type SidebarLink } from './sidebar';
import { sidebarIconAttrs } from './sidebar-icon';
import { catalogSystemRows } from './systems';
import { docPage } from './ui/lib/docs';

/** What the domain-first sidebar is built from: the parts of the catalog it reads. */
export interface DomainSidebarCatalog {
  events: CatalogEvent[];
  apis: CatalogApi[];
  graph: ResourceGraph;
  overviews: Overview[];
  flows: Flow[];
  designs: Design[];
  model: { entities: Entity[] };
}

type Item = SidebarLink | SidebarGroup;

/** A link with its kind's icon, as the catalog's own pages are drawn. */
const link = (label: string, href: string, icon?: SidebarLink['icon']): SidebarLink => ({
  label,
  link: href,
  ...(icon && { attrs: sidebarIconAttrs(icon) }),
});

/** A group that leaves itself out when it has nothing in it. */
const group = (label: string, items: Item[], collapsed = true): SidebarGroup[] =>
  items.length > 0 ? [{ label, collapsed, items }] : [];

/**
 * The Catalog sidebar: Domains first, each opening on its overview and then
 * what is in it, from the catalog, so nobody keeps a sidebar per domain. Then
 * a link to each of the catalog's `pages`.
 *
 * Returns nothing when the catalog has no domains, and the site keeps its
 * list of pages.
 */
export function domainSidebar(
  catalog: DomainSidebarCatalog,
  indexPages: SidebarLink[],
  { apiLabel = 'Scalar' }: { apiLabel?: string | undefined } = {},
): SidebarGroup[] {
  const domains = buildDomains(catalog.events, catalog.graph);

  if (domains.length === 0) return [];

  // As Starlight takes them: the icon drawn, not named.
  const pages = indexPages.map((page) => link(page.label, page.link, page.icon));

  const overviewOf = (id: string) =>
    catalog.overviews.find(({ kind, target }) => kind === 'domain' && target === id);

  const titleOf = (id: string) => overviewOf(id)?.name ?? titleCase(id);

  const services = catalogServices(catalog);

  const systems = catalogSystemRows(catalog, '/');

  const documents = catalog.graph.resources.filter(
    (resource): resource is CatalogResource => resource.ref.kind === 'document',
  );

  const commands = catalog.graph.resources
    .filter(({ ref }) => ref.kind === 'command')
    .sort((a, b) => (a.title ?? a.ref.id).localeCompare(b.title ?? b.ref.id));

  const documentLink = (resource: CatalogResource) =>
    link(
      resource.title ?? resource.ref.id,
      `/${docPage(`${resource.ref.namespace}/${resource.ref.id}`)}`,
      'doc',
    );

  // Documents whose `about:` names a resource, by that resource.
  const about = (kind: string, id: string) =>
    catalog.graph.relationships
      .filter(
        (relationship) =>
          relationship.type === 'describes' &&
          relationship.to.kind === kind &&
          relationship.to.id === id,
      )
      .flatMap(({ from }) =>
        documents.filter(({ ref }) => ref.namespace === from.namespace && ref.id === from.id),
      )
      .map(documentLink);

  const serviceItem = serviceLink(apiLabel);

  // One domain's group: its overview, its subdomains, then what is in it.
  const domainGroup = (id: string): SidebarGroup => {
    const domain = domains.find((candidate) => candidate.name === id);
    const inDomain = new Set(domain?.services ?? []);

    const subdomains = catalog.overviews
      .filter(({ kind, parent }) => kind === 'domain' && parent === id)
      .map(({ target }) => target)
      .filter((target) => domains.some((candidate) => candidate.name === target))
      .sort();

    const flows = catalog.flows.filter((flow) =>
      flow.steps.some(
        ({ ref }) =>
          (ref?.kind === 'event' && ref.namespace?.split('/').at(-1) === id) ||
          (ref?.kind === 'service' && inDomain.has(ref.id)),
      ),
    );

    return {
      label: titleOf(id),
      collapsed: true,
      items: [
        link('Overview', `/domains/${id}/`, 'domain'),
        ...subdomains.map(domainGroup),
        ...group(
          'Systems',
          systems
            .filter((system) => system.members.some((member) => inDomain.has(member)))
            .map((system) => link(system.name, system.href, 'architecture')),
        ),
        ...group(
          'Services',
          (domain?.services ?? [])
            .filter((name) => services.has(name))
            .map((name) => serviceItem(name, apisForService(catalog.apis, catalog.events, name))),
        ),
        ...group(
          'Events',
          (domain?.events ?? []).map((entry) =>
            link(entry.event.frontmatter.name, `/${eventPath(entry)}`, 'event'),
          ),
        ),
        // A command has no page of its own; the Catalog opens on it.
        ...group(
          'Commands',
          commands
            .filter(({ ref }) => ref.namespace === id)
            .map(({ ref, title, tags }) =>
              link(
                title ?? ref.id,
                `/catalog/?kind=command&q=${encodeURIComponent(ref.id)}`,
                tags.includes('query') ? 'search' : 'chat',
              ),
            ),
        ),
        ...group(
          'Entities',
          catalog.model.entities
            .filter((entity) => entity.domains.includes(id))
            .map((entity) =>
              link(entity.name, `/entities/${entity.repository}/${entity.id}/`, 'entity'),
            ),
        ),
        ...group(
          'Flows',
          flows.map((flow) => link(flow.title, `/${flowPath(flow)}`, 'flow')),
        ),
        ...group('Guides and runbooks', about('domain', id)),
      ],
    };
  };

  const isSubdomain = (id: string) =>
    Boolean(overviewOf(id)?.parent) &&
    domains.some((candidate) => candidate.name === overviewOf(id)?.parent);

  const topLevel = domains
    .map(({ name }) => name)
    .filter((id) => !isSubdomain(id))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));

  return [
    { label: 'Domains', collapsed: false, items: topLevel.map(domainGroup) },
    ...group('Catalog', pages, false),
  ];
}
