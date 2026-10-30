import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { docsCatalog } from '../catalog';
import { eventPath } from '../event-path';
import { docsSiteConfig } from '../config';
import { renderLlmsTxt } from '../llms';
import { listItems } from '../view';

export const GET: APIRoute = async ({ site }) => {
  const config = docsSiteConfig();
  const catalog = await docsCatalog();
  const items = listItems(await getCollection('docs'), catalog.manifest);

  return new Response(
    renderLlmsTxt({
      title: config.title,
      description: config.description,
      // Astro's `site` is the origin only, so the configured `base` has to be
      // joined on here or every link skips the path the site is deployed under.
      base: `${site?.href.replace(/\/$/, '') ?? ''}${import.meta.env.BASE_URL.replace(/\/$/, '')}`,
      items,
      events: catalog.events.map((entry) => ({
        path: eventPath(entry),
        name: entry.event.frontmatter.name,
        summary: entry.event.frontmatter.summary,
        owner: entry.event.frontmatter.owner?.team,
      })),
      model: catalog.model,
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
};
