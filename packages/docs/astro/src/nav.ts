import type { SiteNavLink } from 'autocatalog-docs-core';

/**
 * The two sections of a developer portal, for a site for readers outside that
 * has guides and an API and names no `nav` of its own: Documentation, current on
 * the home page and every guide's section, and API reference, which opens the
 * one API directly. From the reference, the guides are one click away.
 */
export function portalNav(docPages: string[], apiPaths: string[]): SiteNavLink[] {
  if (docPages.length === 0 || apiPaths.length === 0) return [];

  const sections = [
    ...new Set(docPages.flatMap((page) => page.split('/').filter(Boolean).slice(0, 1))),
  ];

  return [
    {
      label: 'Documentation',
      href: '/',
      icon: 'doc',
      match: ['/', ...sections.map((section) => `/${section}/`)],
    },
    {
      label: 'API reference',
      href: apiPaths.length === 1 ? `/${apiPaths[0]}` : '/apis/',
      icon: 'api',
      match: '/apis/',
    },
  ];
}

/**
 * The sections of a catalog for readers inside that names no `nav` of its own:
 * Home, the Catalog's compiled pages (the first path segments in
 * `catalogSegments`, such as `services` or a kind's `decisions`), and Docs, the
 * documents its repositories publish, when there are any besides the home page.
 */
export function catalogNav(docPages: string[], catalogSegments: Iterable<string>): SiteNavLink[] {
  const repositories = [
    ...new Set(docPages.flatMap((page) => page.split('/').filter(Boolean).slice(0, 1))),
  ];

  // Docs opens on the shallowest document, the first of those in the catalog's
  // order; the site's own home page is Home's.
  const first = docPages
    .flatMap((page) => page.replace(/^\//, '') || [])
    .reduce<string | undefined>(
      (best, page) =>
        best === undefined || page.split('/').length < best.split('/').length ? page : best,
      undefined,
    );

  return [
    { label: 'Home', href: '/', icon: 'home' },
    {
      label: 'Catalog',
      href: '/catalog/',
      icon: 'catalog',
      match: [...catalogSegments].map((segment) => `/${segment}/`),
    },
    ...(first
      ? [
          {
            label: 'Docs',
            href: `/${first}`,
            icon: 'doc',
            match: repositories.map((repository) => `/${repository}/`),
          },
        ]
      : []),
  ];
}

/** A header link as it renders on one page. */
export interface NavLinkView {
  label: string;
  href: string;
  icon?: string | undefined;
  current: boolean;
  external: boolean;
}

const EXTERNAL = /^[a-z][a-z\d+.-]*:/i;

/** `/guides` and `/guides/` are one section. */
const slashed = (pathname: string) => (pathname.endsWith('/') ? pathname : `${pathname}/`);

/** A site path under the base the site is served from. */
function withBase(href: string, base: string): string {
  if (EXTERNAL.test(href) || !href.startsWith('/')) return href;

  const prefix = base.replace(/\/$/, '');

  return href.startsWith(`${prefix}/`) ? href : `${prefix}${href}`;
}

/**
 * The header's links for the page at `pathname`. One link at most is current:
 * the one whose `match` is the longest prefix of the page, so `/guides/api/`
 * beats `/guides/` on its own pages. `/` is current only on the home page.
 */
export function navLinks(links: SiteNavLink[], pathname: string, base = '/'): NavLinkView[] {
  const page = slashed(pathname);

  const prefixes = links.map((link) =>
    EXTERNAL.test(link.href)
      ? []
      : [link.match ?? link.href].flat().map((match) => slashed(withBase(match, base))),
  );

  const length = (prefix: string) =>
    prefix === slashed(withBase('/', base))
      ? page === prefix
        ? prefix.length
        : -1
      : page.startsWith(prefix)
        ? prefix.length
        : -1;

  const best = prefixes.map((own) => Math.max(-1, ...own.map(length)));
  const winner = Math.max(...best);

  return links.map((link, index) => ({
    label: link.label,
    href: withBase(link.href, base),
    icon: link.icon,
    current: winner >= 0 && best[index] === winner && best.indexOf(winner) === index,
    external: EXTERNAL.test(link.href),
  }));
}

/** A sidebar entry as Starlight's route data has it, reduced to what sections read. */
type SectionEntry = { type: 'link'; href: string } | { type: 'group'; entries: SectionEntry[] };

/** Every link an entry holds, its own or its groups'. */
export const hrefsIn = (entry: SectionEntry): string[] =>
  entry.type === 'link' ? [entry.href] : entry.entries.flatMap(hrefsIn);

/** The section most of an entry's links belong to, if any. */
function sectionOf(entry: SectionEntry, links: SiteNavLink[], base: string): number | undefined {
  const votes = new Map<number, number>();

  for (const href of hrefsIn(entry)) {
    const section = navLinks(links, href, base).findIndex(({ current }) => current);

    if (section >= 0) votes.set(section, (votes.get(section) ?? 0) + 1);
  }

  return [...votes].sort(([, a], [, b]) => b - a)[0]?.[0];
}

/**
 * The sidebar for the section the page is in: its own groups, and any group no
 * section claims. A page outside every section, or in one that holds no group,
 * keeps the whole sidebar, so the sidebar always has a way on.
 */
export function sectionSidebar<Entry extends SectionEntry>(
  entries: Entry[],
  links: SiteNavLink[],
  pathname: string,
  base = '/',
): Entry[] {
  const current = navLinks(links, pathname, base).findIndex((link) => link.current);

  if (current < 0) return entries;

  const sections = entries.map((entry) => sectionOf(entry, links, base));

  if (!sections.includes(current)) return entries;

  return entries.filter((_, index) => sections[index] === undefined || sections[index] === current);
}

/**
 * The sidebar under a heading that names its section: a first group of the
 * same name gives up its label, and its rows lead the sidebar, so the name is
 * not said twice.
 */
export function liftSectionGroup<Entry extends SectionEntry & { label?: string }>(
  entries: Entry[],
  section: string,
): Entry[] {
  const [first, ...rest] = entries;

  if (
    first?.type !== 'group' ||
    first.label?.trim().toLowerCase() !== section.trim().toLowerCase()
  ) {
    return entries;
  }

  // SAFETY: a group's entries are entries of the same sidebar, so of the same type.
  return [...(first.entries as Entry[]), ...rest];
}
