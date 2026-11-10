import { z } from 'astro/zod';
import { apiPath, apisForService, apiTitle, catalogServices, type CatalogApi } from './apis';
import {
  frontmatterSchema,
  readDocs,
  type ReadDocsOptions,
  type RepositoryMeta,
  repositoryMetas,
  type SiteNavigation,
} from 'autocatalog-docs-core';
import type { ResourceGraph } from 'autocatalog-core';
import type { CatalogEvent } from './catalog';
import { eventPath } from './event-path';
import type { IconName } from './icons';
import { sidebarIconAttrs, type SidebarIconAttrs } from './sidebar-icon';
import { docPage } from './ui/lib/docs';

/** The subset of Starlight's sidebar config this generates. */
export interface SidebarLink {
  label: string;
  link: string;
  /** The catalog page a site names it by, when the link goes somewhere more useful. */
  id?: string;
  /** Drawn before the label, as the catalog's own pages are. */
  icon?: IconName;
  /** What Starlight puts on the link: the icon. */
  attrs?: SidebarIconAttrs;
}

const starlightLink = ({ label, link, icon }: SidebarLink): SidebarLink => ({
  label,
  link,
  ...(icon && { attrs: sidebarIconAttrs(icon) }),
});

export interface SidebarGroup {
  label: string;
  collapsed?: boolean;
  items: Array<SidebarLink | SidebarGroup>;
}

/** A group of the catalog's own pages; a service with an API nests its links one level. */
export interface CatalogGroup {
  label: string;
  collapsed: boolean;
  items: Array<SidebarLink | SidebarGroup>;
}

export interface CatalogSidebarOptions {
  /** What the link to an API's reference under its service is called. */
  apiLabel?: string;
  /** The composed resource graph, whose declared services have pages too. */
  graph?: ResourceGraph | undefined;
}

/** A sidebar link with where it sits among its neighbours. */
interface Page extends SidebarLink {
  order: number;
  index: boolean;
  /** The folders it is in under `docs/`, outermost first. */
  folders: string[];
}

// Words a folder name is usually an acronym for; `meta.json` names any folder exactly.
const ACRONYMS = new Set(['api', 'apis', 'cli', 'faq', 'faqs', 'sdk', 'sla', 'sre', 'sso', 'url']);

/** A folder's label when `meta.json` gives none: `it` is IT, `faqs` FAQs, `on-call` On Call. */
export const titleCase = (name: string) =>
  name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, _index, words) => {
      const lower = word.toLowerCase();

      // A folder named in two letters alone is an acronym; `on` in `on-call` is a word.
      if ((words.length === 1 && word.length <= 2) || ACRONYMS.has(lower)) {
        return lower.endsWith('s') && lower.length > 3
          ? `${lower.slice(0, -1).toUpperCase()}s`
          : word.toUpperCase();
      }

      return `${word[0]!.toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');

const links = (pages: Page[]): SidebarLink[] =>
  [...pages]
    .sort((a, b) => Number(b.index) - Number(a.index) || a.order - b.order)
    .map(({ label, link }) => ({ label, link }));

/**
 * A folder's pages: its own first, then a group for each folder in it, the
 * ones `meta.json` lists in its order and with its labels, then the rest.
 */
function repositoryItems(
  pages: Page[],
  meta: RepositoryMeta,
  within: string[] = [],
): SidebarGroup['items'] {
  const depth = within.length;
  const here = pages.filter(({ folders }) => folders.length === depth);
  const below = (name: string) => pages.filter(({ folders }) => folders[depth] === name);
  const pathOf = (name: string) => [...within, name].join('/');

  // The folders meta.json lists directly in this one.
  const listed = (meta.sidebar ?? []).filter(
    ({ directory }) => directory.split('/').slice(0, -1).join('/') === within.join('/'),
  );

  const named = new Set(listed.map(({ directory }) => directory));

  const others = [...new Set(pages.flatMap(({ folders }) => folders[depth] ?? []))]
    .filter((folder) => !named.has(pathOf(folder)))
    .sort();

  const group = (name: string, label: string, collapsed: boolean): SidebarGroup => ({
    label,
    collapsed,
    items: repositoryItems(below(name), meta, [...within, name]),
  });

  return [
    ...links(here),
    ...listed
      .map(({ directory, label, collapsed = false }) => ({
        name: directory.split('/').at(-1)!,
        label,
        collapsed,
      }))
      .filter(({ name }) => below(name).length > 0)
      .map(({ name, label, collapsed }) => group(name, label, collapsed)),
    ...others.map((folder) => group(folder, titleCase(folder), true)),
  ];
}

/**
 * One sidebar group per enrolled repository, built from what is on disk.
 *
 * Starlight's `autogenerate` walks directories under its own content root and
 * labels entries from the file tree. Reading the documents instead means the
 * navigation shows each document's real title, and enrolling a repository is
 * cloning it rather than editing this site's config.
 */
export function docsSidebar(root: string, options: ReadDocsOptions = {}): SidebarGroup[] {
  const repositories = new Map<string, Page[]>();

  for (const doc of readDocs(root, options)) {
    // Starlight's own `sidebar` frontmatter, honoured as its autogenerated
    // navigation would. Malformed, it is ignored rather than hiding the page.
    const sidebar = starlightSidebar.safeParse(doc.data.sidebar);
    const { order, label, hidden } = sidebar.success ? (sidebar.data ?? {}) : {};

    if (hidden) continue;
    // Frontmatter title, falling back to the id: an invalid document still
    // has to be reachable, or nobody can navigate to the thing to fix it.
    const title = frontmatterSchema.shape.title.safeParse(doc.data.title);
    const parts = doc.id.slice(doc.repo.length + 1).split('/');
    const index = doc.id === `${doc.repo}/index`;
    const pages = repositories.get(doc.repo) ?? [];

    pages.push({
      label: label ?? (index ? 'Overview' : title.success ? title.data : doc.id),
      link: `/${docPage(doc.id)}`,
      order: order ?? Number.MAX_VALUE,
      index,
      folders: parts.slice(0, -1),
    });
    repositories.set(doc.repo, pages);
  }

  const metas = repositoryMetas(root, options);

  return [...repositories]
    .map(([repo, pages]) => {
      const meta = metas.get(repo) ?? {};

      return {
        order: meta.order ?? Number.MAX_VALUE,
        group: {
          label: meta.label ?? repo,
          // Starlight opens the group holding the current page.
          ...(repositories.size > 1 && { collapsed: true }),
          items: repositoryItems(pages, meta),
        },
      };
    })
    .sort((a, b) => a.order - b.order || a.group.label.localeCompare(b.group.label))
    .map(({ group }) => group);
}

/** The catalog's own pages, as a site arranged them, or in one group as they came. */
export function navigationGroups(
  pages: SidebarLink[],
  navigation?: SiteNavigation,
): SidebarGroup[] {
  if (!navigation) {
    return pages.length > 0 ? [{ label: 'Catalog', items: pages.map(starlightLink) }] : [];
  }

  return navigation.groups.flatMap(({ label, collapsed, items }) => {
    const resolved = items.flatMap((item): SidebarLink[] => {
      if ('href' in item) return [{ label: item.label, link: item.href }];

      const found = pages.find(({ id, link }) => (id ?? link.slice(1)) === item.id);

      return found ? [{ ...starlightLink(found), ...(item.label && { label: item.label }) }] : [];
    });

    return resolved.length > 0
      ? [{ label, ...(collapsed !== undefined && { collapsed }), items: resolved }]
      : [];
  });
}

/** The part of Starlight's `sidebar` frontmatter a generated entry can honour. */
const starlightSidebar = z
  .object({
    order: z.number().optional(),
    label: z.string().optional(),
    hidden: z.boolean().optional(),
  })
  .optional();

/**
 * A service in the sidebar: a link to its page, or, when it serves an API, a
 * group of its page and a link to each API's reference, named by `apiLabel`
 * alone for one and with the API's title for several.
 */
export const serviceLink =
  (apiLabel: string) =>
  (name: string, served: CatalogApi[]): SidebarLink | SidebarGroup => {
    const page = { label: name, link: `/services/${name}/` };

    if (served.length === 0) return page;

    return {
      label: name,
      collapsed: true,
      items: [
        { label: 'Overview', link: page.link },
        ...served.map((api) => ({
          label: served.length === 1 ? apiLabel : `${apiLabel}: ${apiTitle(api)}`,
          link: `/${apiPath(api)}`,
        })),
      ],
    };
  };

/**
 * Events grouped by domain, then the services, whether the events or the
 * OpenAPI specs name them. Built from the catalog's validated events and
 * APIs, so a repository quarantined for a broken catalog has no entries here
 * either, and every link has a page behind it.
 */
export function catalogSidebar(
  events: CatalogEvent[],
  apis: CatalogApi[] = [],
  { apiLabel = 'Scalar', graph }: CatalogSidebarOptions = {},
): CatalogGroup[] {
  const domains = new Map<string, SidebarLink[]>();

  for (const entry of events) {
    const { name, domain } = entry.event.frontmatter;
    domains.set(domain, [
      ...(domains.get(domain) ?? []),
      { label: name, link: `/${eventPath(entry)}` },
    ]);
  }

  const services = [...catalogServices({ events, apis, graph }).keys()].sort();

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

  const serviceItem = serviceLink(apiLabel);

  return [
    ...[...domains]
      .sort(([a], [b]) => a.localeCompare(b))
      // Starlight group labels are plain text, so the domain's page leads its group.
      .map(([domain, items]) => ({
        label: `Events · ${domain}`,
        collapsed: true,
        items: [{ label: 'Overview', link: `/domains/${domain}/` }, ...items.sort(byLabel)],
      })),
    ...(services.length > 0
      ? [
          {
            label: 'Services',
            // Open from the start: the list a reader most often comes for.
            collapsed: false,
            items: services.map((name) => serviceItem(name, apisForService(apis, events, name))),
          },
        ]
      : []),
  ];
}
