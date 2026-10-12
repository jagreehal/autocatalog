import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { docsCatalog } from './catalog';

/**
 * Every page gets the shell, and every document page names its markdown twin
 * in <head>: an agent that fetches the HTML finds the version it would rather
 * read, without guessing the `.md` convention.
 */
export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute;

  // Starlight's 404 is a splash page, which has no sidebar and so no shell. A
  // reader who lands on a dead link needs the way back more than anyone.
  if (route.id === '404') route.hasSidebar = true;

  const catalog = await docsCatalog();

  if (!(route.id in catalog.manifest)) return;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  route.head.push({
    tag: 'link',
    attrs: { rel: 'alternate', type: 'text/markdown', href: `${base}${route.id}.md` },
  });
});
