import { type Doc, readDocs } from 'autocatalog-docs-core';
import { docsSiteConfig } from './config';
import { docPage } from './ui/lib/docs';

/**
 * The documents as they were authored, for the raw markdown twin.
 *
 * Deliberately not the `docs` content collection: by the time an entry reaches
 * a route its frontmatter has been through Starlight's schema and carries
 * defaults nobody wrote — `editUrl`, `head`, `template`, `sidebar`, `pagefind`,
 * `draft`. Serialising that would publish a document the repository does not
 * contain, and one that a closed frontmatter contract would reject. Same root,
 * same glob and same ids as the collection, so the twin exists for exactly the
 * pages Starlight renders.
 */
export function docPaths() {
  const { root, repo, repository, exclude } = docsSiteConfig();

  // An index document is served at its folder, so its twin answers there as well.
  return readDocs(root, { repo, repository, exclude }).flatMap((doc) =>
    [...new Set([doc.id, docPage(doc.id)])].map((slug) => ({ params: { slug }, props: { doc } })),
  );
}

export interface DocProps {
  doc: Doc;
}
