import {
  componentAttributesSchema,
  isComponentId,
  type ComponentResourceAttributes,
  type ResourceGraph,
} from 'autocatalog-core';
import { ownerFor, ownerHref, type Owner } from './owners';

export interface ComponentStoryRow {
  id: string;
  name: string;
  description: string | undefined;
  snippet: string | undefined;
  /** The story in the team's viewer, when it is deployed. */
  href: string | undefined;
}

export interface ComponentRow {
  id: string;
  name: string;
  repository: string;
  /** The page, from the site's base. */
  path: string;
  href: string;
  /** The team, linked when it has an owner page. */
  owner: { team: string; href: string | undefined } | undefined;
  description: string | undefined;
  import: string | undefined;
  /** The tool that shows the stories, by name. */
  viewer: string | undefined;
  props: ComponentResourceAttributes['props'];
  stories: ComponentStoryRow[];
  /** Other repositories with a component of this name. */
  alsoIn: string[];
}

/** A repository's name as one segment of a page's path. */
const isRepositorySegment = (name: string | undefined) =>
  name !== undefined && /^[^/\\]+$/.test(name) && !/^\.+$/.test(name);

/** Every component on the graph, with where to see each story. */
export function buildComponents(
  graph: ResourceGraph,
  base: string,
  owners: Owner[] = [],
): ComponentRow[] {
  const components = graph.resources.flatMap((resource) => {
    if (resource.ref.kind !== 'component') return [];

    // Another site's graph can join through --index: what has no page is left out.
    if (!isRepositorySegment(resource.ref.namespace) || !isComponentId(resource.ref.id)) return [];

    const facts = componentAttributesSchema.safeParse(resource.attributes);

    return facts.success ? [{ resource, facts: facts.data }] : [];
  });

  const repositoriesOf = (name: string) =>
    components.flatMap(({ resource }) =>
      resource.title === name ? [resource.ref.namespace ?? ''] : [],
    );

  const ownerOf = (team: string | undefined) => {
    if (!team) return undefined;

    const owner = ownerFor(owners, team);

    return { team: owner?.name ?? team, href: owner && ownerHref(owner) };
  };

  return components
    .map(({ resource, facts }) => {
      const repository = resource.ref.namespace ?? '';
      const page = `components/${repository}/${resource.ref.id}/`;
      const deployed = facts.viewer?.url?.replace(/\/+$/, '');

      return {
        id: resource.ref.id,
        name: resource.title,
        repository,
        path: page,
        href: `${base}${page}`,
        owner: ownerOf(resource.owner?.team),
        description: resource.summary,
        import: facts.import,
        viewer: facts.viewer?.name,
        props: facts.props,
        stories: facts.stories.map((story) => ({
          id: story.id,
          name: story.name,
          description: story.description,
          snippet: story.snippet,
          href: deployed && story.link ? `${deployed}/${story.link}` : undefined,
        })),
        alsoIn: [...new Set(repositoriesOf(resource.title))]
          .filter((other) => other !== repository)
          .sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.repository.localeCompare(b.repository));
}
