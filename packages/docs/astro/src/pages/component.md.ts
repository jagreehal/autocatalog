// The component page as Markdown: how to import it, its props and each story.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';
import { componentRows } from '../page-models';
import { componentTwin, pageUrl } from '../twins';

export async function getStaticPaths() {
  const catalog = await docsCatalog();
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return componentRows(catalog, base).map((component) => ({
    params: { repository: component.repository, id: component.id },
    props: { component },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props, site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(componentTwin(props.component, pageUrl(site, base, props.component.path)), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
};
