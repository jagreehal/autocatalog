/** One document as the index and the listings render it. */
export interface DocListItem {
  id: string;
  repo: string;
  title: string;
  owner: string;
  /** ISO date of the last commit touching the file, or null if git cannot say. */
  updated: string | null;
  tags: string[];
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

  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Root-relative URL for a document, honouring Astro's configured `base`.
 *
 * Starlight prefixes the base onto sidebar and page links itself; the links
 * this plugin renders are ours to prefix, and a hard-coded leading slash breaks
 * every one of them the day a site is deployed under a path.
 */
export function docHref(id: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${id}`;
}
