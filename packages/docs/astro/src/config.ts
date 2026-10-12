/**
 * What the integration decided, read back by the parts Astro loads on their own.
 *
 * `content.config.ts` is evaluated by Astro outside the integration's module
 * graph, so options cannot simply be passed to it. The environment is the seam
 * Astro itself offers, and the events site already uses it.
 */
export interface DocsSiteConfig {
  /** Absolute aggregation root. */
  root: string;
  /** Set only for the single-repo shape: the URL namespace documents sit under. */
  repo: string | undefined;
  /** Repository identity in the shared graph, when it differs from `repo`. */
  repository: string | undefined;
  /** Path to a committed JSON Schema, or undefined for the built-in contract. */
  schemaPath: string | undefined;
  title: string;
  description: string;
}

export function docsSiteConfig(): DocsSiteConfig {
  return {
    // '..' is the aggregating shape: a site in its own repository reading the
    // sibling repositories checked out beside it.
    root: process.env.AUTOCATALOG_DOCS_ROOT ?? '..',
    repo: process.env.AUTOCATALOG_DOCS_REPO || undefined,
    repository: process.env.AUTOCATALOG_DOCS_REPOSITORY || undefined,
    schemaPath: process.env.AUTOCATALOG_DOCS_SCHEMA || undefined,
    title: process.env.AUTOCATALOG_DOCS_TITLE ?? 'Documentation',
    description:
      process.env.AUTOCATALOG_DOCS_DESCRIPTION ??
      'Documentation committed beside the code it describes, aggregated into one index.',
  };
}
