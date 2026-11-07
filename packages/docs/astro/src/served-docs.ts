import type { Doc } from 'autocatalog-docs-core';
import { servedPath } from './access';
import { fullCatalog } from './catalog';
import { docHref } from './ui/lib/docs';

/**
 * The document a request or link path opens, if it opens one: at its page,
 * and for an index document at its id's own path as well.
 */
export async function servedDoc(pathname: string): Promise<Doc | undefined> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  // A document's Markdown twin is the document.
  const path = servedPath(pathname).replace(/\.md$/, '');

  return (await fullCatalog()).docs.find(
    (doc) => docHref(doc.id) === path || `${base}/${doc.id}` === path,
  );
}
