import type { SiteNavLink } from 'autocatalog-docs-core';

/** A header link as it renders on one page. */
export interface NavLinkView {
  label: string;
  href: string;
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
    current: winner >= 0 && best[index] === winner && best.indexOf(winner) === index,
    external: EXTERNAL.test(link.href),
  }));
}
