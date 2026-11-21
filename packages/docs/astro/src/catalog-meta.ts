import type { DocsCatalog } from './catalog';
import type { DocsSiteConfig } from './config';

export const CATALOG_META_SPEC = 'autocatalog/catalog-meta-v1';

/** What one build of the site is made of, and what it had to leave out. */
export interface CatalogMeta {
  spec: typeof CATALOG_META_SPEC;
  builtAt: string;
  /** The lock the build followed, when it followed one. */
  lockDigest: string | null;
  resources: number;
  relationships: number;
  /** Sources that could not be read or compiled: a site missing any is incomplete. */
  failures: number;
  /** Each failure, named, on an open company site; one for an audience or behind `access` counts them only. */
  problems: Array<{ repository: string; source: string; message: string }>;
}

/**
 * The build's own record, served beside `/catalog.json`: when it was built,
 * from which lock, how much it holds and what it left out. `ac site --strict`
 * reads it to refuse publishing a partial catalog, and a monitor can alert on
 * `failures` or an old `builtAt`.
 */
export function catalogMeta(
  catalog: Pick<DocsCatalog, 'graph' | 'failures'>,
  config: Pick<DocsSiteConfig, 'leftOut' | 'lockDigest' | 'audience' | 'access'>,
  now = new Date(),
): CatalogMeta {
  const problems = [
    ...config.leftOut.map(({ name, reason }) => ({
      repository: name,
      source: 'clone',
      message: reason,
    })),
    ...catalog.failures.map(({ repository, source, message }) => ({ repository, source, message })),
  ];

  return {
    spec: CATALOG_META_SPEC,
    builtAt: now.toISOString(),
    lockDigest: config.lockDigest ?? null,
    resources: catalog.graph.resources.length,
    relationships: catalog.graph.relationships.length,
    failures: problems.length,
    // Repository names and errors are the company's. The file is built ahead,
    // so no access check stands in front of it: a gated site counts them only.
    problems: config.audience || config.access ? [] : problems,
  };
}
