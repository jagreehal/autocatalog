// The event page as Markdown, beside the HTML: the contract, its narrative and
// its schema in one file an agent can read or cite.
import type { APIRoute, InferGetStaticPropsType } from 'astro';
import { docsCatalog } from '../catalog';
import { eventPath } from '../event-path';
import { eventSource, eventTwin, pageUrl } from '../twins';

export async function getStaticPaths() {
  const catalog = await docsCatalog();

  return catalog.events.map((entry) => ({
    params: {
      repository: entry.repository,
      domain: entry.event.frontmatter.domain,
      id: entry.event.frontmatter.id,
    },
    props: { entry },
  }));
}

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props, site }) => {
  const { entry } = props;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  return new Response(
    eventTwin(entry, { source: eventSource(entry), url: pageUrl(site, base, eventPath(entry)) }),
    { headers: { 'content-type': 'text/markdown; charset=utf-8' } },
  );
};
