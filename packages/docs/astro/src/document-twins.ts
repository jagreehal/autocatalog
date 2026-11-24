import { documentsPerRequest } from 'virtual:autocatalog-docs-build';
import { docsSiteConfig, servesDocumentCopies } from './config';

/** Whether this site serves each document's twin, as routes.ts decides. Read per request. */
export function documentTwinsServed(): boolean {
  const { access, audience, llms } = docsSiteConfig();

  return servesDocumentCopies({
    perRequest: documentsPerRequest,
    access: access !== undefined,
    audience,
    llms,
  });
}
