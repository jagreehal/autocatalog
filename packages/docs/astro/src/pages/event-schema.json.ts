// The contract itself at a stable URL, for a consumer's codegen or an agent,
// beside the page that explains it.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.events.map(({ repository, event }) => ({
    params: { repository, domain: event.frontmatter.domain, id: event.frontmatter.id },
    props: { event },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) => {
  const { event } = props;

  return new Response(`${JSON.stringify(event.schema, null, 2)}\n`, {
    headers: { 'content-type': 'application/schema+json; charset=utf-8' },
  });
};
