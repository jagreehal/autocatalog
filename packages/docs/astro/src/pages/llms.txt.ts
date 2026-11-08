import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { apiPath, apiSummary, apiTitle } from '../apis';
import { readableCatalog } from '../access';
import { docsCatalog } from '../catalog';
import { eventPath } from '../event-path';
import { docsSiteConfig } from '../config';
import { renderLlmsTxt } from '../llms';
import { componentRows } from '../page-models';
import { type DocEntry, listItems } from '../view';
import { catalogId } from '../ui/lib/docs';
import { documentsPerRequest } from 'virtual:autocatalog-docs-build';

export const GET: APIRoute = async ({ site, locals, isPrerendered }) => {
  const config = docsSiteConfig();
  const catalog = await docsCatalog();
  // Documents rendered per request may be gated, so a list built ahead names
  // none of them. On a server site this renders per request, behind the same
  // gate, and lists what this reader may open: with `access`, by its rule.
  const { canRead } = locals;
  const readable = readableCatalog(catalog, canRead);

  const items =
    documentsPerRequest && isPrerendered
      ? []
      : listItems(
          (await getCollection('docs')).filter(
            (entry: DocEntry) => catalogId(entry.id) in readable.manifest,
          ),
          readable.manifest,
        );

  // Astro's `site` is the origin only, so the configured `base` has to be
  // joined on here or every link skips the path the site is deployed under.
  const base = `${site?.href.replace(/\/$/, '') ?? ''}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;

  return new Response(
    renderLlmsTxt({
      title: config.title,
      description: config.description,
      base,
      mcp:
        process.env.AUTOCATALOG_SITE_MCP_ENDPOINT &&
        `${base}/${process.env.AUTOCATALOG_SITE_MCP_ENDPOINT}`,
      items,
      apis: catalog.apis.map((api) => ({
        path: apiPath(api),
        title: apiTitle(api),
        summary: apiSummary(api),
      })),
      events: catalog.events.map((entry) => ({
        path: eventPath(entry),
        name: entry.event.frontmatter.name,
        summary: entry.event.frontmatter.summary,
        owner: entry.event.frontmatter.owner?.team,
      })),
      components: componentRows(catalog, ''),
      model: catalog.model,
      notes: documentsPerRequest && isPrerendered ? [] : readable.flowNotes,
      full: !documentsPerRequest || !isPrerendered,
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
};
