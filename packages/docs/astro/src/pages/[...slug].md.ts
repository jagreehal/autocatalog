// Every page is also published as raw markdown at <url>.md, and each page's
// <head> points here with rel="alternate".
//
// Agents ask for markdown when they can get it, using Accept: text/markdown. A
// static site cannot negotiate content, so the .md URL offers the same thing.
// The frontmatter adds what an agent needs to cite the page: when git last saw
// it change, the file on its repository, and the page's own URL.
import type { APIRoute } from 'astro';
import { docToMarkdown } from 'autocatalog-docs-core';
import { docsCatalog } from '../catalog';
import { docPaths, type DocProps } from '../paths';

export const getStaticPaths = docPaths;

export const GET: APIRoute<DocProps> = async ({ props, site }) => {
  const { doc } = props;
  const record = (await docsCatalog()).manifest[doc.id];
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  const provenance = {
    ...(record?.updated && { updated: record.updated }),
    ...(record?.source && { source: record.source }),
    ...(site && { url: new URL(`${base}${doc.id}/`, site).href }),
  };

  return new Response(docToMarkdown({ ...doc.data, ...provenance }, doc.body), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
};
