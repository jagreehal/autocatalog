// The spec itself beside its reference, as JSON whatever the repository wrote
// it in, for the reference to load and for a client generator.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.apis.map((api) => ({
    params: { repository: api.repository, name: api.name },
    props: { api },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) =>
  new Response(`${JSON.stringify(props.api.document, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
