import type { APIRoute } from 'astro';
import { docsCatalog } from '../catalog';

// The aggregated index other repositories' `ac docs check` resolves links
// against, so the site that renders the documents publishes the same facts.
export const GET: APIRoute = async () => {
  const catalog = await docsCatalog();

  return new Response(`${JSON.stringify(catalog.manifest, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
