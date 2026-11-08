import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { getCollection } from 'astro:content';
import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import type { AccessDoc } from './access';
import { docsCatalog } from './catalog';
import { servedDoc } from './served-docs';
import { catalogId } from './ui/lib/docs';

let built: Promise<Set<string>> | undefined;

/** The ids of the documents Starlight built pages for, as against its own pages. */
function builtDocs(): Promise<Set<string>> {
  built ??= collectionIds();

  return built;
}

async function collectionIds(): Promise<Set<string>> {
  const entries: Array<{ id: string }> = await getCollection('docs');

  return new Set(entries.map((entry) => catalogId(entry.id)));
}

/**
 * Every page gets the shell, and every document page names its markdown twin
 * in <head>: an agent that fetches the HTML finds the version it would rather
 * read, without guessing the `.md` convention.
 */
export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute;

  // The catalog's id for this page's document, when it is one.
  const id = catalogId(route.id);

  // Starlight's 404 is a splash page, which has no sidebar and so no shell. A
  // reader who lands on a dead link needs the way back more than anyone.
  if (route.id === '404') route.hasSidebar = true;

  const catalog = await docsCatalog();

  const { canRead } = context.locals;

  if (canRead) {
    // The middleware answered for a closed document already. One that reaches
    // here by a path it did not know, or that the catalog does not hold, is
    // refused rather than rendered.
    if ((await builtDocs()).has(id) && !canRead({ id })) {
      throw new Error(`access: ${id} reached its page for a reader who may not open it`);
    }

    route.sidebar = await readable(route.sidebar, canRead);

    for (const side of ['prev', 'next'] as const) {
      const link = route.pagination[side];

      if (link && !(await opens(link.href, canRead))) route.pagination[side] = undefined;
    }
  }

  // A document rendered per request has no twin (see DOCUMENT_COPIES), unless
  // `access` serves it per request through the same rule.
  if (!(id in catalog.manifest) || !(context.isPrerendered || canRead)) return;

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  route.head.push({
    tag: 'link',
    attrs: { rel: 'alternate', type: 'text/markdown', href: `${base}${route.id}.md` },
  });
});

/** Whether a link is one this reader may follow: not to a document they may not open. */
async function opens(href: string, canRead: (doc: AccessDoc) => boolean): Promise<boolean> {
  const doc = await servedDoc(href);

  return !doc || canRead(doc);
}

type SidebarEntry = StarlightRouteData['sidebar'][number];

/** The sidebar without the documents this reader may not open, or groups left empty. */
async function readable(
  entries: SidebarEntry[],
  canRead: (doc: AccessDoc) => boolean,
): Promise<SidebarEntry[]> {
  const kept: SidebarEntry[] = [];

  for (const entry of entries) {
    if (entry.type === 'link') {
      if (await opens(entry.href, canRead)) kept.push(entry);
      continue;
    }

    const children = await readable(entry.entries, canRead);

    if (children.length > 0) kept.push({ ...entry, entries: children });
  }

  return kept;
}
