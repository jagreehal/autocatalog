import type { APIRoute } from 'astro';
import { docsCatalog } from './catalog';
import type { DocProps } from './paths';
import { docTwin, pageUrl } from './twins';
import { docPage, entryId } from './ui/lib/docs';

/**
 * A document as raw Markdown, at its page's URL with `.md`. Agents ask for
 * Markdown when they can get it; a static site cannot negotiate content, so
 * the `.md` URL offers it. Per request, the access rule decides, whatever path
 * reached it.
 */
export const docTwinRoute: APIRoute<Partial<DocProps>> = async ({
  props,
  params,
  site,
  locals,
}) => {
  const catalog = await docsCatalog();

  const doc =
    props.doc ??
    catalog.docs.find(
      (each) => entryId(each.id) === params.slug || docPage(each.id) === params.slug,
    );

  if (!doc || (locals.canRead && !locals.canRead(doc))) {
    return new Response('Not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(docTwin(doc, catalog.manifest, pageUrl(site, base, `${docPage(doc.id)}/`)), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
};
