// An earlier version's contract, beside its page, for a consumer pinned to it.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.history.map(({ repository, event }) => ({
    params: {
      repository,
      domain: event.frontmatter.domain,
      id: event.frontmatter.id,
      version: event.frontmatter.version,
    },
    props: { event },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) => {
  const { event } = props;

  return new Response(`${JSON.stringify(event.schema, null, 2)}\n`, {
    headers: { 'content-type': 'application/schema+json; charset=utf-8' },
  });
};
