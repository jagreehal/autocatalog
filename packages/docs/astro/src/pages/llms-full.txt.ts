import type { APIRoute } from 'astro';
import { docsCatalog } from '../catalog';
import { docsSiteConfig } from '../config';
import { modelMarkdown } from '../data-models';
import { eventPath } from '../event-path';
import { renderLlmsFullTxt } from '../llms';
import { docTwin, eventSource, eventTwin, pageUrl } from '../twins';

export const GET: APIRoute = async ({ site }) => {
  const config = docsSiteConfig();
  const catalog = await docsCatalog();
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  // Documents by id, then events, as llms.txt lists them; then data models.
  const docs = [...catalog.docs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => docTwin(doc, catalog.manifest, pageUrl(site, base, `${doc.id}/`)));

  const events = catalog.events.map((entry) =>
    eventTwin(entry, { source: eventSource(entry), url: pageUrl(site, base, eventPath(entry)) }),
  );

  const models = catalog.models.map((model) =>
    modelMarkdown(catalog, model, { base, url: (page) => pageUrl(site, base, page) }),
  );

  return new Response(
    renderLlmsFullTxt({
      title: config.title,
      description: config.description,
      twins: [...docs, ...events, ...models],
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
};
