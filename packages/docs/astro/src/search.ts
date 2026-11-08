import { type ChatFound, queryWords, rankPages } from 'autocatalog-chatbot';
import { docsCatalog } from './catalog';
import { chatPages } from './chat';

/** A query is cut to this many characters. */
const QUERY_LIMIT = 200;

export interface SiteSearch {
  /** The query's words, as results mark them. */
  words: string[];
  /** Every page that matched, best first. */
  results: ChatFound[];
}

/**
 * Search the pages this reader may open, as the built-in `/search` does: for a
 * site's own search page, which can count searches or link results its way.
 */
export async function searchSite(
  asked: string,
  canRead?: ((doc: { id: string }) => boolean) | undefined,
): Promise<SiteSearch> {
  const query = asked.trim().slice(0, QUERY_LIMIT);

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  const pages = chatPages(await docsCatalog(), base).filter(
    (page) => !canRead || page.id === undefined || canRead({ id: page.id }),
  );

  return { words: queryWords(query), results: rankPages(pages, query, pages.length) };
}

export { SearchPage, type SearchPageProps } from './ui/pages/SearchPage';
