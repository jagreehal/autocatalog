// Who is reading, and whether they may open the document they asked for. The
// site's `access` module decides; this applies it before any page renders.
import type { APIContext } from 'astro';
import type { Doc } from 'autocatalog-docs-core';
import { defineMiddleware } from 'astro:middleware';
import { access, denied } from 'virtual:autocatalog-access';
import { z } from 'zod';
import { accessRule, SIGNED_OUT } from './access';
import { fullCatalog } from './catalog';
import { readerView } from './reader-view';
import { servedDoc } from './served-docs';

/** Whoever the site's `reader` says is reading: a type of the site's own. */
type SiteReader = Awaited<ReturnType<typeof access.reader>>;

export const onRequest = defineMiddleware(async (context, next) => {
  // A page asks of any copy of a document, such as Starlight's entry; the
  // rule reads the catalog's, which has the access `meta.json` gives it. One
  // the catalog does not hold stays closed: the rule cannot see what it needs.
  const docs = new Map((await fullCatalog()).docs.map((each) => [each.id, each]));

  const ruleFor = (reader: SiteReader | undefined) => {
    const rule = accessRule(access, reader);

    return (doc: { id: string }) => {
      const known = docs.get(doc.id);

      return known !== undefined && rule(known);
    };
  };

  // A page built ahead is the same for everyone, so it shows what a signed-out
  // reader may open: its sidebar and every list of documents on it.
  if (context.isPrerendered) {
    const canRead = ruleFor(undefined);

    Object.assign(context.locals, { canRead });

    return readerView.run(canRead, next);
  }

  // `ac site dev` views the site as one of the module's sample readers.
  const viewing = import.meta.env.DEV ? viewAs(context) : undefined;

  if (viewing instanceof Response) return viewing;

  const reader = viewing ? viewing.reader : await access.reader(context);
  const canRead = ruleFor(reader);

  Object.assign(context.locals, { reader, canRead });

  if (import.meta.env.DEV && access.readers) {
    context.locals.viewAs = {
      names: [SIGNED_OUT, ...Object.keys(access.readers)],
      current: viewing?.name,
    };
  }

  const doc = await servedDoc(context.url.pathname);

  // Every page renders as this reader may see the catalog: see `docsCatalog`.
  const response = await readerView.run(canRead, () =>
    doc && !canRead(doc) ? refuse(context, doc, reader) : next(),
  );

  // What one reader is shown is not for a shared cache to hand the next.
  if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'private');

  return response;
});

const VIEW_AS = 'autocatalog-view-as';

/**
 * `?view-as=<name>` views the site as that sample reader until `?view-as=`
 * clears it: a redirect that sets the cookie, then the reader it names.
 */
function viewAs(context: APIContext): Response | { name: string; reader: unknown } | undefined {
  const asked = context.url.searchParams.get('view-as');

  if (asked !== null) {
    if (asked) context.cookies.set(VIEW_AS, asked, { path: '/' });
    else context.cookies.delete(VIEW_AS, { path: '/' });

    return context.redirect(context.url.pathname);
  }

  const name = context.cookies.get(VIEW_AS)?.value;

  if (name === SIGNED_OUT) return { name, reader: undefined };

  return name && access.readers?.[name] !== undefined
    ? { name, reader: access.readers[name] }
    : undefined;
}

const text = z.string().min(1).optional().catch(undefined);

/**
 * What a closed document answers with: a 404, or with `teaser` its title and a
 * 403. Its Markdown twin answers in Markdown, as an agent asking for it reads.
 */
async function refuse(
  context: APIContext,
  doc: Doc,
  reader: SiteReader | undefined,
): Promise<Response> {
  await access.onDenied?.(doc, reader, context);

  const title = text.parse(doc.data.title) ?? doc.id;
  const description = text.parse(doc.data.description) ?? text.parse(doc.data.summary);

  if (context.url.pathname.endsWith('.md')) {
    return denied === 'teaser'
      ? new Response(
          [`# ${title}`, description, 'This page is not available on your account.']
            .filter(Boolean)
            .join('\n\n')
            .concat('\n'),
          { status: 403, headers: { 'content-type': 'text/markdown; charset=utf-8' } },
        )
      : new Response('Not found\n', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
  }

  if (denied === 'teaser') context.locals.denied = { id: doc.id, title, description };

  const page = await context.rewrite(denied === 'teaser' ? '/no-access' : '/404');

  return new Response(page.body, {
    status: denied === 'teaser' ? 403 : 404,
    headers: page.headers,
  });
}
