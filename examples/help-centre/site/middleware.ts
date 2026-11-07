// Signing in, and the assistant's words for whoever is reading. Runs after
// autocatalog has set `locals.reader` from site/access.ts.
import { findReader, type Reader, suggestionsFor } from './readers.ts';

interface Context {
  url: URL;
  cookies: {
    set(name: string, value: string, options: { path: string; httpOnly: boolean }): void;
    delete(name: string, options: { path: string }): void;
  };
  locals: { reader?: Reader | undefined; chat?: { description?: string; suggestions?: string[] } };
  isPrerendered: boolean;
  redirect(to: string): Response;
}

export function onRequest(context: Context, next: () => Promise<Response>) {
  const { url, cookies, locals } = context;

  // A page built ahead of time has no reader: it is the same for everyone.
  if (context.isPrerendered) return next();

  // ?reader=<id> signs in as that account, ?reader= signs out.
  const asked = url.searchParams.get('reader');

  if (asked !== null) {
    if (findReader(asked)) cookies.set('reader', asked, { path: '/', httpOnly: true });
    else cookies.delete('reader', { path: '/' });

    return context.redirect(url.pathname);
  }

  const { reader } = locals;

  locals.chat = {
    description: reader ? `Answers from the guides for ${reader.name}` : 'Sign in for your guides.',
    suggestions: suggestionsFor(reader),
  };

  return next();
}
