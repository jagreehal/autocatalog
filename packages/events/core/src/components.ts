import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ownerForPath } from './codeowners';
import { loadCodeowners } from './enrich-event';
import { jsonObjectSchema, type JsonObject } from './json';
import { readOptionalResourceJson } from './resource-files';
import {
  AUTOCATALOG_GRAPH_SPEC,
  createRepositoryResource,
  type CatalogRelationship,
  type ResourceGraph,
  type TypedCatalogResource,
} from './resource-graph';

/**
 * The UI components a repository publishes, committed beside its code so they
 * move with a lock and a tag as contracts do. Any tool can write this file: a
 * plugin reads its own format and calls {@link writeComponents}. The components
 * stay in that tool, and the catalog lists them and links to each one.
 */
export const COMPONENTS_FILE = 'autocatalog.components.json';

/** A component's id is a segment of its page's path, and `.md` belongs to its twin. */
export const isComponentId = (id: string): boolean =>
  /^[\p{L}\p{N}_.-]+$/u.test(id) && !/^\.+$/.test(id) && !id.endsWith('.md');

const componentId = z.string().refine(isComponentId, 'not a path segment');

/** Only a web address, since a site links to it: never `javascript:`. */
const webUrl = z
  .string()
  .refine((url) => /^https?:\/\//i.test(url) && URL.canParse(url), 'an http or https URL');

const story = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  snippet: z.string().optional(),
  /** Where it is in the viewer, joined onto the viewer's `url`. */
  link: z.string().optional(),
});

const prop = z.strictObject({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean(),
  description: z.string().optional(),
});

const component = z.strictObject({
  id: componentId,
  name: z.string(),
  description: z.string().optional(),
  import: z.string().optional(),
  /** The file it is defined in, from the repository's root: what CODEOWNERS matches. */
  source: z.string().optional(),
  props: z.array(prop),
  stories: z.array(story),
});

/** The tool that shows the components, and where it is deployed. */
const viewer = z.strictObject({ name: z.string().min(1), url: webUrl.optional() });

export const componentsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  viewer: viewer.optional(),
  /** Who owns every component here. Without it, CODEOWNERS says, per component. */
  owner: z.string().min(1).optional(),
  components: z.array(component),
});

export type CatalogComponent = z.infer<typeof component>;

export type ComponentViewer = z.infer<typeof viewer>;

export type ComponentsFile = z.infer<typeof componentsFileSchema>;

/** A component's facts in the graph, read back by anything that shows it. */
export const componentAttributesSchema = z.object({
  import: z.string().optional(),
  source: z.string().optional(),
  viewer: viewer.optional(),
  props: z.array(prop),
  stories: z.array(story),
});

export type ComponentResourceAttributes = z.infer<typeof componentAttributesSchema>;

export type ComponentCatalogResource = TypedCatalogResource<'component', JsonObject>;

/** The repository's {@link COMPONENTS_FILE} as committed, or nothing when it has none. */
export async function readComponentsFile(root: string): Promise<ComponentsFile | undefined> {
  const file = path.join(root, COMPONENTS_FILE);
  const value = await readOptionalResourceJson(file, { root });

  if (value === undefined) return undefined;

  const parsed = componentsFileSchema.safeParse(value);

  if (!parsed.success) throw new Error(`${COMPONENTS_FILE}: ${z.prettifyError(parsed.error)}`);

  return parsed.data;
}

/**
 * The repository's components as graph resources, each defined by the
 * repository, so owners, search, `--index` and every other reader of the graph
 * see them as they see an event. The owner is the file's, else CODEOWNERS'.
 */
export async function createComponentResourceGraph(
  repository: string,
  root: string,
  options: { ownersWithin?: string } = {},
): Promise<ResourceGraph | undefined> {
  const file = await readComponentsFile(root);

  if (!file) return undefined;

  const rules = await loadCodeowners(root, options.ownersWithin);

  const resources: ComponentCatalogResource[] = file.components.map((entry) => {
    const { id, name, description, ...facts } = entry;
    const team = file.owner ?? (entry.source && ownerForPath(rules, entry.source));

    return {
      ref: { kind: 'component', namespace: repository, id },
      title: name,
      ...(description && { summary: description }),
      url: `components/${repository}/${id}/`,
      ...(team && { owner: { team } }),
      tags: [],
      provenance: { default: 'extracted', fields: {} },
      needsReview: false,
      source: { type: 'code', file: COMPONENTS_FILE },
      attributes: jsonObjectSchema.parse({
        ...facts,
        ...(file.viewer && { viewer: file.viewer }),
      }),
    };
  });

  const relationships: CatalogRelationship[] = resources.map(({ ref }) => ({
    type: 'defines',
    from: { kind: 'repository', id: repository },
    to: ref,
    provenance: 'extracted',
    needsReview: false,
  }));

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [createRepositoryResource(repository), ...resources],
    relationships,
  };
}

/**
 * Write a repository's {@link COMPONENTS_FILE}, for a plugin to call with what
 * it read. The viewer and the owner stay as committed unless given again, so a
 * rebuild needs neither. Sorted, so reading the same source twice
 * commits nothing new. `check` compares instead of writing.
 */
export async function writeComponents(
  root: string,
  input: {
    components: CatalogComponent[];
    viewer?: ComponentViewer | undefined;
    owner?: string | undefined;
  },
  options: { check?: boolean | undefined } = {},
): Promise<'written' | 'current' | 'stale'> {
  const committed = await readComponentsFile(root);
  const name = input.viewer?.name ?? committed?.viewer?.name;

  // An address belongs to its tool: a new viewer does not inherit the old one's.
  const url =
    input.viewer?.url ?? (committed?.viewer?.name === name ? committed?.viewer?.url : undefined);

  const owner = input.owner ?? committed?.owner;

  const file = componentsFileSchema.parse({
    ...(committed?.$schema && { $schema: committed.$schema }),
    ...(name && { viewer: { name, ...(url && { url }) } }),
    ...(owner && { owner }),
    components: [...input.components].sort((a, b) => a.id.localeCompare(b.id)),
  });

  const text = `${JSON.stringify(file, null, 2)}\n`;
  const out = path.join(root, COMPONENTS_FILE);

  if (options.check)
    return (await fs.readFile(out, 'utf8').catch(() => undefined)) === text ? 'current' : 'stale';

  await fs.writeFile(out, text);

  return 'written';
}
