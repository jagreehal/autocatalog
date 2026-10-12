import { buildDocsManifest, type DocsManifest } from 'autocatalog-docs-core';
import { docsSiteConfig } from './config';

let cached: DocsManifest | undefined;

/**
 * The aggregated index: last-changed dates and backlinks, both facts about the
 * whole company that no single document holds.
 *
 * Built here rather than read from a committed `contracts/docs-manifest.json`,
 * so a site can never render an index that disagrees with the files it just
 * read. Publishing that artifact for other repositories to check against stays
 * a separate step (`ac docs manifest`) because it is a different job.
 *
 * A document that breaks the contract throws, which fails the build. Rendering
 * a partial index would quietly answer "who links to this" with a lie.
 *
 * One `git log` per document, once per build. A single `git log --name-only`
 * walk would serve a very large monorepo.
 */
export function docsManifest(): DocsManifest {
  if (!cached) {
    const { root, repo, schemaPath } = docsSiteConfig();
    cached = buildDocsManifest(root, { repo, schemaPath });
  }

  return cached;
}
