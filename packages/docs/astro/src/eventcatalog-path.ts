/** Where `ac site --eventcatalog` puts EventCatalog's output inside the site. */
const EVENTCATALOG_DIR = 'eventcatalog/';

/** Characters a URL path segment may hold (RFC 3986 pchar), plus the slashes between. */
const PATH = /^(?:[\w\-.~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})*$/;

/**
 * A page inside the hosted EventCatalog, relative to the site base, or null.
 * The value arrives on the URL, so it must only ever name a path under
 * EventCatalog's own directory: never another origin, a scheme, a query, or a
 * `.`/`..` segment, encoded or not. Anything else a path may hold — a SemVer
 * `1.0.0+build.7`, an encoded space — is a page EventCatalog can have built.
 */
export function eventCatalogPath(value: string | null): string | null {
  if (!value?.startsWith(EVENTCATALOG_DIR) || !PATH.test(value)) return null;

  const dotSegment = value.split('/').some((segment) => {
    const decoded = segment.replace(/%2e/gi, '.');

    return decoded === '.' || decoded === '..';
  });

  return dotSegment ? null : value;
}

/** The hosted EventCatalog, opened at one of its pages. */
export function architectureHref(base: string, path: string): string {
  return `${base}architecture/?at=${encodeURIComponent(path)}`;
}
