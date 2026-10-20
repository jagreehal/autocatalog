// A data model's page as Markdown: its fields, relations and who reads and writes it.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';
import { modelMarkdown } from '../data-models';
import { pageUrl } from '../twins';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.models.map((model) => ({
    params: { repository: model.repository, name: model.name },
    props: { model },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = async ({
  props,
  site,
}) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(
    modelMarkdown(await docsCatalog(), props.model, {
      base,
      url: (page) => pageUrl(site, base, page),
    }),
    { headers: { 'content-type': 'text/markdown; charset=utf-8' } },
  );
};
