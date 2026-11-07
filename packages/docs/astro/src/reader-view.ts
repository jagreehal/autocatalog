import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccessDoc } from './access';

/**
 * Whether the reader a page is rendering for may open a document, on a site
 * with `access`. The access middleware runs each page inside it: the reader's
 * rule per request, a signed-out reader's for a page built ahead.
 */
export const readerView = new AsyncLocalStorage<(doc: AccessDoc) => boolean>();
