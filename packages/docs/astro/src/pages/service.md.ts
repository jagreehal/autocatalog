// The service page as Markdown: what it produces and consumes, each event
// linked to its own twin.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { catalogServices } from '../apis';
import { docsCatalog } from '../catalog';
import { eventsForService } from '../event-path';
import { serviceBasis, serviceFacts } from '../page-models';
import { pageUrl, serviceTwin } from '../twins';

export async function getStaticPaths() {
  const catalog = await docsCatalog();
  const services = catalogServices(catalog);

  return [...services.values()].map(({ name }) => ({ params: { name }, props: { name } }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = async ({
  props,
  site,
}) => {
  const { name } = props;
  const catalog = await docsCatalog();
  const { events, graph } = catalog;
  const facts = serviceFacts(graph, name);
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(
    serviceTwin(
      {
        name,
        summary: facts.summary ?? serviceBasis(catalog, name).description,
        owner: facts.owner?.team,
      },
      {
        produces: eventsForService(events, name, 'producers'),
        consumes: eventsForService(events, name, 'consumers'),
      },
      { base, repository: facts.repository, url: pageUrl(site, base, `services/${name}/`) },
    ),
    { headers: { 'content-type': 'text/markdown; charset=utf-8' } },
  );
};
