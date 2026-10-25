// The specification itself, under its own file name, for a client or a tool
// that reads the format. The host serves it with the type its extension says.
import path from 'node:path';
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.specifications.map((spec) => ({
    params: { repository: spec.repository, name: spec.name, file: path.posix.basename(spec.file) },
    props: { spec },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) =>
  new Response(props.spec.source);
