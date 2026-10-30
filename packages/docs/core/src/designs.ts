import fs from 'node:fs';
import path from 'node:path';
import {
  isEventCatalogResource,
  isServiceCatalogResource,
  parseFrontmatter,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { aboutReference, resolveAbout } from './about';
import type { Diagram, DiagramEdgeType, DiagramNode, DiagramNodeType } from './diagram';

/** Where a repository keeps its designs: one Markdown file each. */
export const DESIGNS_DIR = 'designs';

// The vocabulary of EventCatalog Studio's model (MIT, @eventcatalog/visualiser/model):
// a design's frontmatter is a model Studio can open, with `ref` and `status` beside it.
const RESOURCE_TYPES = [
  'domain',
  'system',
  'service',
  'agent',
  'event',
  'command',
  'query',
  'channel',
  'actor',
  'external-system',
  'container',
  'team',
  'view',
  'entity',
] as const;

const RELATION_KINDS = [
  'sends',
  'receives',
  'routes-through',
  'reads',
  'writes',
  'connects',
] as const;

export type DesignStatus = 'draft' | 'proposed' | 'accepted' | 'rejected';

/** `catalog`: the catalog already has it. `new`: the design proposes it. */
export type DesignState = 'catalog' | 'new';

export interface DesignResource {
  id: string;
  type: (typeof RESOURCE_TYPES)[number];
  name: string;
  summary?: string | undefined;
  /** The domain or system it sits in, by its id in the design. */
  parent?: string | undefined;
  technology?: string | undefined;
  /** The catalog resource it is, when it is one. */
  ref?: ResourceRef | undefined;
  state: DesignState;
}

export interface DesignRelation {
  from: string;
  to: string;
  kind: (typeof RELATION_KINDS)[number];
  label?: string | undefined;
  state: DesignState;
}

/**
 * Architecture a team proposes before it is built: the resources and the
 * relations between them, checked against the catalog so a reader sees what
 * is new. Reviewed as a pull request, like the code that will make it true.
 */
export interface Design {
  repository: string;
  /** Its file name without `.md`, its page's segment. */
  id: string;
  /** Where the repository keeps it, from the repository's root. */
  file: string;
  title: string;
  summary?: string | undefined;
  status: DesignStatus;
  body: string;
  resources: DesignResource[];
  relations: DesignRelation[];
  notes: DesignNote[];
  /** What a reader should know first: risks, single points of failure, open questions. */
  hotspots: DesignHotspot[];
  /** Where the canvas put each resource, by level; absent until the design is edited on one. */
  layout?: DesignLayout | undefined;
}

export type DesignNote = z.output<typeof noteSchema>;

export type DesignHotspot = z.output<typeof hotspotSchema>;

export type DesignLayout = z.output<typeof layoutSchema>;

const text = z.string().trim().min(1);

const id = z.union([text, z.number().transform(String)]);

const resourceSchema = z
  .object({
    id: id.optional(),
    ref: text.optional(),
    type: z.enum(RESOURCE_TYPES).optional(),
    name: text.optional(),
    summary: text.optional(),
    parent: id.optional(),
    technology: text.optional(),
  })
  .strict()
  .refine((resource) => resource.ref ?? (resource.id && resource.type), {
    message: 'a resource names the catalog resource it is (`ref`), or gives an `id` and `type`',
  });

// Studio's sticky notes and text: where one sits and how it looks are kept, so
// the canvas opens as it was left.
export const noteSchema = z
  .object({
    text,
    resource: id.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    color: z.enum(['yellow', 'blue', 'green', 'pink', 'purple', 'gray']).optional(),
    kind: z.enum(['sticky', 'text']).optional(),
    fontSize: z.number().optional(),
    level: z.enum(['overview', 'services', 'messages']).optional(),
  })
  .strict();

const hotspotSchema = z
  .object({
    title: text,
    severity: z.enum(['critical', 'warning', 'info']).default('warning'),
    description: text.optional(),
    resource: id.optional(),
  })
  .strict();

const place = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .strict();

export const layoutSchema = z
  .object({
    overview: z.record(z.string(), place).optional(),
    services: z.record(z.string(), place).optional(),
    messages: z.record(z.string(), place).optional(),
  })
  .strict();

export const designSchema = z
  .object({
    title: text,
    summary: text.optional(),
    status: z.enum(['draft', 'proposed', 'accepted', 'rejected']).default('draft'),
    // Empty while it is being started: `ac site` dev's New design writes one with none.
    resources: z.array(resourceSchema).default([]),
    relations: z
      .array(
        z
          .object({ from: id, to: id, kind: z.enum(RELATION_KINDS), label: text.optional() })
          .strict(),
      )
      .default([]),
    notes: z.array(noteSchema).default([]),
    hotspots: z.array(hotspotSchema).default([]),
    layout: layoutSchema.optional(),
  })
  .strict();

/** A design as its schema reads one: what a file's frontmatter or an agent's draft says. */
export type DesignInput = z.output<typeof designSchema>;

const KINDS: Partial<Record<DesignResource['type'], string>> = {
  service: 'service',
  agent: 'agent',
  event: 'event',
  command: 'command',
  domain: 'domain',
};

// A catalog resource's kind as the design names its type.
const TYPES = new Map<string, DesignResource['type']>([
  ['service', 'service'],
  ['agent', 'agent'],
  ['event', 'event'],
  ['command', 'command'],
  ['domain', 'domain'],
  ['tool', 'service'],
  ['channel', 'channel'],
  ['table', 'container'],
  ['collection', 'container'],
]);

/**
 * A design as written, resolved against the catalog: each `ref` must name a
 * catalog resource, and a resource written by name is the catalog's when the
 * catalog has one of that kind and name. A relation is the catalog's when the
 * catalog declares it between the same two resources.
 */
export function resolveDesign(
  authored: DesignInput,
  catalog: { resources: CatalogResource[]; relationships: CatalogRelationship[] },
  where: { repository: string; id: string; file: string; body?: string },
  /** Leave a `ref` naming nothing in `catalog` to the composed site, as flows do. */
  options: { deferMissing?: boolean } = {},
): Design {
  const byKey = new Map(catalog.resources.map((resource) => [resourceKey(resource.ref), resource]));

  const resources = authored.resources.map((resource): DesignResource => {
    if (resource.ref) {
      const resolution = resolveAbout(resource.ref, catalog.resources, where.repository);

      const missing = !catalog.resources.some(
        (candidate) => aboutReference(candidate) === resource.ref,
      );

      if ('failure' in resolution && options.deferMissing && missing) {
        const [kind, ...rest] = resource.ref.split('/');

        return {
          id: resource.id ?? rest.at(-1)!,
          type: resource.type ?? TYPES.get(kind!) ?? 'service',
          name: resource.name ?? rest.at(-1)!,
          summary: resource.summary,
          parent: resource.parent,
          technology: resource.technology,
          state: 'catalog',
        };
      }

      if ('failure' in resolution) throw new Error(resolution.failure);

      const found = byKey.get(resourceKey(resolution.ref));

      return {
        id: resource.id ?? resolution.ref.id,
        type: resource.type ?? TYPES.get(resolution.ref.kind) ?? 'service',
        name: resource.name ?? found?.title ?? resolution.ref.id,
        summary: resource.summary ?? found?.summary,
        parent: resource.parent,
        technology: resource.technology,
        ref: resolution.ref,
        state: 'catalog',
      };
    }

    const type = resource.type!;
    const name = resource.name ?? resource.id!;

    // Written by name: the catalog's own when exactly one resource of that kind has the name.
    const matches = catalog.resources.filter(
      (candidate) =>
        candidate.ref.kind === KINDS[type] &&
        (candidate.ref.id === name || candidate.ref.id === resource.id),
    );

    const ref = matches.length === 1 ? matches[0]!.ref : undefined;

    // A domain is an attribute of the events and services in it more often than a resource.
    const usedDomain =
      type === 'domain' &&
      catalog.resources.some(
        (candidate) =>
          (isEventCatalogResource(candidate) &&
            [name, resource.id].includes(candidate.attributes.domain)) ||
          (isServiceCatalogResource(candidate) &&
            candidate.attributes.domains.some((domain) => [name, resource.id].includes(domain))),
      );

    return {
      id: resource.id!,
      type,
      name,
      summary: resource.summary ?? (ref && byKey.get(resourceKey(ref))?.summary),
      parent: resource.parent,
      technology: resource.technology,
      ref,
      state: ref || usedDomain ? 'catalog' : 'new',
    };
  });

  const ids = new Map<string, DesignResource>();

  for (const resource of resources) {
    if (ids.has(resource.id)) throw new Error(`resource '${resource.id}' appears twice`);
    ids.set(resource.id, resource);
  }

  for (const resource of resources) {
    if (resource.parent && !ids.has(resource.parent)) {
      throw new Error(
        `resource '${resource.id}' sits in '${resource.parent}', which is not a resource`,
      );
    }
  }

  const declared = new Set(
    catalog.relationships.map(
      ({ type, from, to }) => `${type} ${resourceKey(from)} ${resourceKey(to)}`,
    ),
  );

  const relations = authored.relations.map((relation): DesignRelation => {
    const from = ids.get(relation.from);
    const to = ids.get(relation.to);

    for (const end of [relation.from, relation.to]) {
      if (!ids.has(end)) {
        throw new Error(
          `relation ${relation.from} ${relation.kind} ${relation.to}: '${end}' is not a resource`,
        );
      }
    }

    // The catalog's verbs: a service sending an event produces it; receiving one consumes it.
    const backed =
      from?.ref &&
      to?.ref &&
      (relation.kind === 'sends'
        ? declared.has(`produces ${resourceKey(from.ref)} ${resourceKey(to.ref)}`) ||
          declared.has(`sends ${resourceKey(from.ref)} ${resourceKey(to.ref)}`)
        : relation.kind === 'receives'
          ? declared.has(`consumes ${resourceKey(to.ref)} ${resourceKey(from.ref)}`) ||
            declared.has(`handles ${resourceKey(from.ref)} ${resourceKey(to.ref)}`)
          : declared.has(`${relation.kind} ${resourceKey(from.ref)} ${resourceKey(to.ref)}`));

    return { ...relation, state: backed ? 'catalog' : 'new' };
  });

  for (const note of authored.notes) {
    if (note.resource && !ids.has(note.resource)) {
      throw new Error(`a note is on '${note.resource}', which is not a resource`);
    }
  }

  for (const hotspot of authored.hotspots) {
    if (hotspot.resource && !ids.has(hotspot.resource)) {
      throw new Error(
        `hotspot '${hotspot.title}' is on '${hotspot.resource}', which is not a resource`,
      );
    }
  }

  return {
    ...where,
    body: where.body ?? '',
    title: authored.title,
    summary: authored.summary,
    status: authored.status,
    resources,
    relations,
    notes: authored.notes,
    hotspots: authored.hotspots,
    layout: authored.layout,
  };
}

export interface ReadDesignsResult {
  designs: Design[];
  /** One line per design left out, naming its file and what is wrong. */
  failures: string[];
}

/** The designs each repository keeps under `designs/`, resolved against the composed catalog. */
export function readDesigns(
  repositories: Array<{ repository: string; dir: string }>,
  catalog: { resources: CatalogResource[]; relationships: CatalogRelationship[] },
  options: { deferMissing?: boolean } = {},
): ReadDesignsResult {
  const result: ReadDesignsResult = { designs: [], failures: [] };

  for (const { repository, dir } of repositories) {
    const folder = path.join(dir, DESIGNS_DIR);

    // A real directory only: a symlink could point anywhere on the build machine.
    if (!fs.lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) continue;

    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const file = `${DESIGNS_DIR}/${entry.name}`;
      const id = path.posix.basename(file, '.md');

      try {
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
          throw new Error(
            `'${id}' cannot be a page's address; use letters, digits, '.', '-' and '_'`,
          );
        }

        const { data, content } = parseFrontmatter(
          fs.readFileSync(path.join(folder, entry.name), 'utf8'),
        );

        const parsed = designSchema.safeParse(data);

        if (!parsed.success) {
          throw new Error(z.prettifyError(parsed.error).replace(/\n+/g, '; '));
        }

        result.designs.push(
          resolveDesign(
            parsed.data,
            catalog,
            { repository, id, file, body: content.trim() },
            options,
          ),
        );
      } catch (error) {
        result.failures.push(
          `${repository}/${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  result.designs.sort(
    (a, b) => a.repository.localeCompare(b.repository) || a.id.localeCompare(b.id),
  );

  return result;
}

/** What a design adds to the catalog, in a line: "2 new services, 1 new event and 3 new relations". */
export function designChanges(design: Design): string {
  const counts = new Map<string, number>();

  for (const resource of design.resources) {
    if (resource.state === 'new') counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }

  const relations = design.relations.filter((relation) => relation.state === 'new').length;

  const parts = [
    ...[...counts].map(([type, n]) => `${n} new ${type}${n === 1 ? '' : 's'}`),
    ...(relations > 0 ? [`${relations} new relation${relations === 1 ? '' : 's'}`] : []),
  ];

  if (parts.length === 0) return 'Nothing new: the catalog already has all of it';

  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const NODE_TYPES: Record<DesignResource['type'], DiagramNodeType> = {
  domain: 'domain',
  system: 'domain',
  service: 'service',
  agent: 'agent',
  event: 'event',
  command: 'command',
  query: 'query',
  channel: 'channel',
  actor: 'actor',
  'external-system': 'external-system',
  container: 'data',
  team: 'actor',
  view: 'actor',
  entity: 'data',
};

const EDGE_TYPES: Record<DesignRelation['kind'], DiagramEdgeType> = {
  sends: 'publishes',
  receives: 'subscribes',
  'routes-through': 'sends',
  reads: 'reads-from',
  writes: 'writes-to',
  connects: 'calls',
};

const MESSAGES = new Set<DiagramNodeType>(['event', 'command', 'query', 'channel']);

/**
 * A design as the visualiser draws it at level 3: every resource that is not
 * a domain or system, with what is new marked. Levels 2 and 1 come with it:
 * the services and stores with the messages between them bridged, then the
 * domains and systems with everything folded into them.
 */
export function designDiagram(design: Design): Diagram & {
  /** Resource ids the design proposes, drawn as proposed. */
  proposed: string[];
  levels: { 1?: Pick<Diagram, 'nodes' | 'edges'>; 2: Pick<Diagram, 'nodes' | 'edges'> };
} {
  const groups = new Set(['domain', 'system']);

  const node = (resource: DesignResource): DiagramNode => ({
    id: resource.id,
    type: NODE_TYPES[resource.type],
    label: resource.name,
    metadata: {
      ...(resource.summary && { summary: resource.summary }),
      ...(resource.technology && { technology: resource.technology }),
      ...(resource.state === 'new' && { proposed: true }),
      // Level 1 draws a domain or system as a card the visualiser connects edges to.
      ...((resource.type === 'domain' || resource.type === 'system') && { group: resource.type }),
    },
  });

  const related = new Set(design.relations.flatMap(({ from, to }) => [from, to]));

  // A domain or system is drawn only when a relation names it, laid out as a plain
  // step: the layout makes a domain a container and drops edges to containers.
  const nodes = design.resources.flatMap((resource) =>
    !groups.has(resource.type)
      ? [node(resource)]
      : related.has(resource.id)
        ? [{ ...node(resource), type: 'step' as const }]
        : [],
  );

  // A received message is drawn flowing into its receiver, as the catalog map draws it.
  const edges = design.relations.map((relation) => {
    const reverse = relation.kind === 'receives';

    return {
      id: `${relation.from}->${relation.to}:${relation.kind}`,
      source: reverse ? relation.to : relation.from,
      target: reverse ? relation.from : relation.to,
      type: EDGE_TYPES[relation.kind],
      label: relation.label ?? relation.kind,
    };
  });

  const types = new Map(nodes.map((n) => [n.id, n.type]));

  // Level 2: a message between two parts becomes one edge from sender to receiver, named for it.
  const kept = nodes.filter((n) => !MESSAGES.has(n.type));

  const bridged = new Map<string, { source: string; target: string; labels: string[] }>();

  for (const via of nodes.filter((n) => MESSAGES.has(n.type))) {
    const into = edges.filter(
      (edge) => edge.target === via.id && !MESSAGES.has(types.get(edge.source)!),
    );

    const out = edges.filter(
      (edge) => edge.source === via.id && !MESSAGES.has(types.get(edge.target)!),
    );

    for (const a of into) {
      for (const b of out) {
        const key = `${a.source}->${b.target}`;
        const entry = bridged.get(key) ?? { source: a.source, target: b.target, labels: [] };

        entry.labels.push(via.label);
        bridged.set(key, entry);
      }
    }
  }

  const direct = edges.filter(
    (edge) => !MESSAGES.has(types.get(edge.source)!) && !MESSAGES.has(types.get(edge.target)!),
  );

  const level2 = {
    nodes: kept,
    edges: [
      ...direct,
      ...[...bridged].map(([key, { source, target, labels }]) => ({
        id: key,
        source,
        target,
        type: 'calls' as const,
        label: labels.join(', '),
      })),
    ],
  };

  // Level 1: each part folded into the domain or system it sits in.
  const parents = new Map(design.resources.map((resource) => [resource.id, resource.parent]));

  // Level 1 keeps systems as well as domains, as a system context does.
  const groupOf = (resourceId: string) => parents.get(resourceId);

  const level1Edges = new Map<string, { source: string; target: string; labels: Set<string> }>();

  for (const edge of level2.edges) {
    const source = groupOf(edge.source) ?? edge.source;
    const target = groupOf(edge.target) ?? edge.target;

    if (source === target) continue;

    const key = `${source}->${target}`;
    const entry = level1Edges.get(key) ?? { source, target, labels: new Set<string>() };

    if (edge.label) entry.labels.add(edge.label);
    level1Edges.set(key, entry);
  }

  // Every domain and system, even one whose relations all stay inside it, and
  // whatever else an edge between them reaches.
  const level1Ids = new Set([
    ...design.resources.filter((resource) => groups.has(resource.type)).map(({ id }) => id),
    ...[...level1Edges.values()].flatMap(({ source, target }) => [source, target]),
  ]);

  const hasGroups = design.resources.some((resource) => groups.has(resource.type));

  return {
    nodes,
    edges,
    proposed: design.resources.filter((r) => r.state === 'new').map((r) => r.id),
    levels: {
      2: level2,
      ...(hasGroups && {
        1: {
          nodes: design.resources
            .filter((resource) => level1Ids.has(resource.id))
            // Laid out as plain steps, as above; the views draw each one as its card.
            .map((resource) => ({ ...node(resource), type: 'step' as const })),
          edges: [...level1Edges].map(([key, { source, target, labels }]) => ({
            id: key,
            source,
            target,
            type: 'calls' as const,
            label: [...labels].join(', '),
          })),
        },
      }),
    },
  };
}
