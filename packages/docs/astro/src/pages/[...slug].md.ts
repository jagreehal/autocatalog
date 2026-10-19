// Every page is also published as raw markdown at <url>.md, and each page's
// <head> points here with rel="alternate".
//
// Agents ask for markdown when they can get it, using Accept: text/markdown. A
// static site cannot negotiate content, so the .md URL offers the same thing.
import type { APIRoute } from 'astro';
import { docsCatalog } from '../catalog';
import { docPaths, type DocProps } from '../paths';
import { docTwin, pageUrl } from '../twins';

export const getStaticPaths = docPaths;

export const GET: APIRoute<DocProps> = async ({ props, site }) => {
  const { doc } = props;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(
    docTwin(doc, (await docsCatalog()).manifest, pageUrl(site, base, `${doc.id}/`)),
    { headers: { 'content-type': 'text/markdown; charset=utf-8' } },
  );
};
