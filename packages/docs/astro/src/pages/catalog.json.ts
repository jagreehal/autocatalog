import type { APIRoute } from 'astro';
import { docsCatalog } from '../catalog';

export const GET: APIRoute = async () => {
  const catalog = await docsCatalog();

  return new Response(`${JSON.stringify(catalog.graph, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
