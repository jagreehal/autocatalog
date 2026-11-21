import { resourceKey, type CatalogResource, type ResourceGraph } from 'autocatalog-core';
import { z } from 'zod';
import { catalogAnchor, skillHref } from './view';

export { skillHref };

/** A link to another row on the page, or to a page of its own. */
export interface SkillLink {
  label: string;
  href?: string | undefined;
}

/** One skill, slash command or Cursor rule. */
export interface SkillRow {
  anchor: string;
  title: string;
  summary?: string | undefined;
  format: 'skill' | 'command' | 'cursor-rule';
  /** Tools it may use without asking. */
  allowedTools: string[];
  /** The plugin that ships it, when one does. */
  plugin?: SkillLink | undefined;
  /** The repository it is in, when it is not a plugin's. */
  repository?: string | undefined;
  owners: string[];
  needsReview: boolean;
}

/** One coding-agent plugin, with what it ships and who turns it on. */
export interface PluginRow {
  anchor: string;
  title: string;
  summary?: string | undefined;
  version?: string | undefined;
  marketplace?: string | undefined;
  /** Where a marketplace fetches it from, when it lives elsewhere. */
  source?: string | undefined;
  skills: SkillLink[];
  agents: string[];
  commands: string[];
  hooks: string[];
  servers: SkillLink[];
  /** Repositories that build it. */
  builtIn: string[];
  /** Repositories whose settings turn it on. */
  usedBy: string[];
  owners: string[];
  needsReview: boolean;
}

const List = z.array(z.string()).catch([]);

const skillAttributes = z.object({
  format: z.enum(['skill', 'command', 'cursor-rule']).catch('skill'),
  allowed_tools: List,
  plugin: z.string().optional().catch(undefined),
  owners: List,
});

const pluginAttributes = z.object({
  version: z.string().optional().catch(undefined),
  marketplace: z.string().optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  agents: List,
  commands: List,
  hooks: List,
  servers: List,
  owners: List,
});

/** A discovered entry's owner until a person names one. */
const UNREVIEWED_OWNER = 'review-needed';

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

const ownersOf = (resource: CatalogResource, owners: string[]) =>
  sorted([...(resource.owner ? [resource.owner.team] : []), ...owners]).filter(
    (owner) => owner !== UNREVIEWED_OWNER,
  );

/** The skills page: plugins, then skills, commands and rules. */
export interface SkillsView {
  plugins: PluginRow[];
  skills: SkillRow[];
}

/** Every skill and coding-agent plugin on the graph, each by title. */
export function buildSkills(graph: ResourceGraph, base: string): SkillsView {
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));

  const edges = (type: string, side: 'from' | 'to', resource: CatalogResource) =>
    graph.relationships.flatMap((edge) => {
      if (edge.type !== type) return [];

      const [here, there] = side === 'to' ? [edge.to, edge.from] : [edge.from, edge.to];

      return resourceKey(here) === resourceKey(resource.ref) ? [there] : [];
    });

  const plugins = graph.resources
    .filter(({ ref }) => ref.kind === 'agent-plugin')
    .map((resource): PluginRow => {
      const facts = pluginAttributes.parse(resource.attributes);

      const repositories = (type: string) =>
        sorted(
          edges(type, 'to', resource)
            .filter(({ kind }) => kind === 'repository')
            .map(({ id }) => id),
        );

      return {
        anchor: catalogAnchor(resource.ref),
        title: resource.title,
        summary: resource.summary,
        ...facts,
        skills: edges('defines', 'from', resource).map((ref) => ({
          label: byKey.get(resourceKey(ref))?.title ?? ref.id,
          href: skillHref(base, { ref }),
        })),
        servers: facts.servers.map((id) => {
          const server = byKey.get(resourceKey({ kind: 'mcp-server', id }));

          return { label: server?.title ?? id, href: server && `${base}mcp-servers/${id}/` };
        }),
        builtIn: repositories('defines'),
        usedBy: repositories('usesPlugin'),
        owners: ownersOf(resource, facts.owners),
        needsReview: resource.needsReview,
      };
    });

  const skills = graph.resources
    .filter(({ ref }) => ref.kind === 'skill')
    .map((resource): SkillRow => {
      const facts = skillAttributes.parse(resource.attributes);

      const shippedBy = edges('defines', 'to', resource).find(
        ({ kind }) => kind === 'agent-plugin',
      );

      const plugin = shippedBy && byKey.get(resourceKey(shippedBy));

      return {
        anchor: catalogAnchor(resource.ref),
        title: resource.title,
        summary: resource.summary,
        format: facts.format,
        allowedTools: facts.allowed_tools,
        plugin: plugin && { label: plugin.title, href: skillHref(base, plugin) },
        repository: plugin ? undefined : resource.ref.namespace,
        owners: ownersOf(resource, facts.owners),
        needsReview: resource.needsReview,
      };
    });

  const byTitle = <T extends { title: string }>(a: T, b: T) => a.title.localeCompare(b.title);

  return { plugins: plugins.sort(byTitle), skills: skills.sort(byTitle) };
}
