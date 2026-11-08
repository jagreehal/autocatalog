/** One document as the index and the listings render it. */
export interface DocListItem {
  id: string;
  repo: string;
  title: string;
  owner: string;
  /** ISO date of the last commit touching the file, or null if git cannot say. */
  updated: string | null;
  tags: string[];
  /** Its kind, state and date, when it is a decision, runbook or incident. */
  kind?: string | undefined;
  status?: string | undefined;
  date?: string | undefined;
}

/**
 * The one date format the whole site uses.
 *
 * Null renders as nothing rather than as a guess: a stale date on a runbook is
 * worse than no date, because it reads as a promise.
 */
export function day(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) return null;

  // In UTC, so a date-only value (`2026-10-18`) is that day wherever the site is built.
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Root-relative URL for a document, honouring Astro's configured `base`.
 *
 * Starlight prefixes the base onto sidebar and page links itself; the links
 * this plugin renders are ours to prefix, and a hard-coded leading slash breaks
 * every one of them the day a site is deployed under a path.
 */
export function docHref(id: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${docPage(id)}`;
}

/**
 * The repository a site publishes at its root, without its name in the path:
 * `atRoot` in autocatalog.site.json. The build defines it for every page; the
 * build's own code reads the environment.
 */
function rootRepository(): string | undefined {
  return (
    import.meta.env.AUTOCATALOG_DOCS_ROOT_REPO ||
    globalThis.process?.env?.AUTOCATALOG_DOCS_ROOT_REPO ||
    undefined
  );
}

/** A document's id as Starlight routes it: without the repository a site publishes at its root. */
export function entryId(id: string): string {
  const root = rootRepository();

  return root && id.startsWith(`${root}/`) ? id.slice(root.length + 1) : id;
}

/** The catalog's id for the document Starlight routes as `entry`. */
export function catalogId(entry: string): string {
  const root = rootRepository();

  return root ? `${root}/${entry}` : entry;
}

/** Where a document is served: an index document at its folder. */
export function docPage(id: string): string {
  return entryId(id).replace(/(^|\/)index$/, '');
}
