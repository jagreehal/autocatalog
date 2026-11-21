import type { APIRoute } from 'astro';
import { docsCatalog } from '../catalog';
import { catalogMeta } from '../catalog-meta';
import { docsSiteConfig } from '../config';

// Written once, when the site is built: a server site's record says when that was.
export const prerender = true;

export const GET: APIRoute = async () =>
  new Response(`${JSON.stringify(catalogMeta(await docsCatalog(), docsSiteConfig()), null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
