import { relative } from 'node:path';
import {
  AUTOCATALOG_GRAPH_SPEC,
  createRepositoryResource,
  relationshipKey,
  resourceKey,
  type AgentSystemCatalogResource,
  type AgentSystemResourceAttributes,
  type CatalogRelationship,
  type CatalogRelationshipType,
  type CatalogResource,
  type ProvenanceValue,
  type ResourceGraph,
  type ResourceRef,
  type SourceLocation,
} from 'autocatalog-core';
import { type Catalog, refKey } from './loader.js';
import { type Entity, type EntityKind, ENTITY_KINDS } from './schemas.js';
import { linkEvents, type EventLink } from './events.js';
import { validateEdges } from './validator.js';

export class AgentsResourceGraphError extends Error {
  constructor(readonly failures: string[]) {
    super(
      `refusing to compile an Agent resource graph with ${failures.length} issue(s): ${failures.join('; ')}`,
    );
    this.name = 'AgentsResourceGraphError';
  }
}

export interface CreateAgentsResourceGraphOptions {
  /** Include links to the standalone Agents UI. Disable in a composed shell. */
  urls?: boolean;
  /** Repository identity supplied by an aggregating filesystem convention. */
  repository?: string;
  /**
   * Events these Agents and Tools may name in `produces` / `consumes`, from every
   * repository the graph is composed with. When given, each reference becomes an
   * edge to the exact Event resource and one that does not resolve fails the
   * graph. When omitted, no event edges are drawn.
   */
  events?: GraphEvent[];
}

/** An Event resource as the composed graph holds it, with the repository that publishes it. */
export interface GraphEvent {
  ref: ResourceRef;
  domain: string;
  id: string;
  repository?: string;
}

function entityRef(entity: Entity): ResourceRef<EntityKind> {
  const ref: ResourceRef<EntityKind> = { kind: entity.kind, id: entity.id };

  if (entity.version) ref.version = entity.version;

  return ref;
}

function provenanceOf(entity: Entity): ProvenanceValue {
  if (!entity.discovery) return 'declared';

  return entity.discovery.confidence === 'inferred' ? 'inferred' : 'extracted';
}

function fieldNeedsReview(entity: Entity, field: string): boolean {
  return (
    entity.discovery?.needs_review.some(
      (candidate) => candidate === field || candidate.startsWith(`${field}.`),
    ) ?? false
  );
}

function evidenceFor(
  entity: Entity,
  field: string,
): Pick<CatalogRelationship, 'provenance' | 'needsReview'> {
  const needsReview = fieldNeedsReview(entity, field);

  return { provenance: needsReview ? 'inferred' : provenanceOf(entity), needsReview };
}

function sourceOf(catalog: Catalog, entity: Entity): SourceLocation | undefined {
  const discovered = [...(entity.discovery?.sources ?? [])].sort((a, b) =>
    `${a.file}:${a.line}:${a.symbol ?? ''}`.localeCompare(`${b.file}:${b.line}:${b.symbol ?? ''}`),
  )[0];

  if (discovered) {
    return {
      type: 'code',
      file: discovered.file,
      line: discovered.line,
      symbol: discovered.symbol,
    };
  }

  const meta = catalog.meta.get(refKey(entity.kind, entity.id));

  if (!meta) return undefined;

  return { file: relative(catalog.root, meta.path).split('\\').join('/') };
}

function repositoryId(url: string): string | null {
  try {
    const parsed = new URL(url);

    const name = parsed.pathname
      .split('/')
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.git$/, '');

    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

function attributesOf(entity: Entity, eventEdges: boolean): AgentSystemResourceAttributes {
  // Event references stay attributes unless they were drawn as edges, so a
  // graph built without the event catalog does not lose them.
  const events = eventEdges ? ['produces', 'consumes'] : [];

  const relationshipFields: Partial<Record<EntityKind, string[]>> = {
    agent: ['model', 'tools', 'policies', 'domain', ...events],
    tool: ['domain', ...events],
    workflow: ['agents', 'domain'],
    eval: ['target'],
  };

  const omitted = new Set([
    'id',
    'kind',
    'name',
    'owner',
    'description',
    'version',
    'discovery',
    ...(relationshipFields[entity.kind] ?? []),
  ]);

  return Object.fromEntries(Object.entries(entity).filter(([key]) => !omitted.has(key)));
}

/** Event links placed on exact Event resources, and the ones that could not be. */
interface EventEdges {
  edges: Array<{ link: EventLink; to: ResourceRef }>;
  failures: string[];
}

/**
 * An event id is unique inside a domain, not across a company: when two
 * repositories publish the same `domain/id`, the one this catalog lives in
 * wins, and with no local copy the reference is ambiguous rather than guessed.
 */
function resolveEventEdges(
  catalog: Catalog,
  options: CreateAgentsResourceGraphOptions,
): EventEdges {
  const candidates = new Map<string, GraphEvent[]>();

  for (const event of options.events ?? []) {
    const key = `${event.domain}/${event.id}`;
    candidates.set(key, [...(candidates.get(key) ?? []), event]);
  }

  const { links, issues } = linkEvents(catalog, options.events ?? []);
  const failures = issues.map((issue) => issue.message);
  const edges: Array<{ link: EventLink; to: ResourceRef }> = [];

  for (const link of links) {
    const all = candidates.get(link.event!) ?? [];
    const local = all.filter((event) => event.repository === options.repository);
    const pick = local.length > 0 ? local : all;

    if (pick.length === 1) {
      edges.push({ link, to: pick[0]!.ref });
    } else {
      const repositories = pick.map((event) => event.repository ?? '(unnamed)').sort();

      failures.push(
        `${link.from.kind}/${link.from.id} ${link.direction} "${link.ref}", which ${repositories.length} repositories publish (${repositories.join(', ')}) — declare it in the repository that owns the event, or rename one`,
      );
    }
  }

  return { edges, failures };
}

/**
 * Adapt one validated Agent catalog into the shared resource graph. The
 * entity-specific fields stay in attributes; shared identity, ownership,
 * evidence, source, and relationships use the graph Interface.
 */
export function createAgentsResourceGraph(
  catalog: Catalog,
  options: CreateAgentsResourceGraphOptions = {},
): ResourceGraph {
  const edgeIssues = validateEdges(catalog);
  const eventEdges = options.events ? resolveEventEdges(catalog, options) : undefined;

  const failures = [
    ...catalog.issues.map((issue) => `${issue.path}: ${issue.message}`),
    ...edgeIssues.map((issue) => issue.message),
    ...(eventEdges?.failures ?? []),
  ];

  if (failures.length > 0) throw new AgentsResourceGraphError(failures);

  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();
  const refs = new Map<string, ResourceRef>();

  for (const kind of ENTITY_KINDS) {
    for (const entity of catalog.entities.get(kind)?.values() ?? []) {
      refs.set(refKey(kind, entity.id), entityRef(entity));
    }
  }

  const addRelationship = (
    type: CatalogRelationshipType,
    from: Entity,
    toKind: EntityKind,
    toId: string,
    field: string,
  ) => {
    const to = refs.get(refKey(toKind, toId));

    if (!to) return;
    const evidence = evidenceFor(from, field);

    const relationship: CatalogRelationship = {
      type,
      from: entityRef(from),
      to,
      ...evidence,
      source: sourceOf(catalog, from),
    };

    relationships.set(relationshipKey(relationship), relationship);
  };

  for (const kind of ENTITY_KINDS) {
    const entities = [...(catalog.entities.get(kind)?.values() ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    for (const entity of entities) {
      const provenance = provenanceOf(entity);

      const resource: AgentSystemCatalogResource = {
        ref: entityRef(entity),
        title: entity.name,
        summary: entity.description,
        url:
          options.urls === false ? undefined : `/${entity.kind}/${encodeURIComponent(entity.id)}`,
        owner: { team: entity.owner },
        tags: [],
        provenance: {
          default: provenance,
          fields: Object.fromEntries(
            (entity.discovery?.needs_review ?? [])
              .slice()
              .sort((a, b) => a.localeCompare(b))
              .map((field) => [field, 'inferred' as const]),
          ),
        },
        needsReview: (entity.discovery?.needs_review.length ?? 0) > 0,
        source: sourceOf(catalog, entity),
        attributes: attributesOf(entity, eventEdges !== undefined),
      };

      resources.set(resourceKey(resource.ref), resource);

      if (entity.kind === 'agent') {
        const agent = entity;
        addRelationship('usesModel', agent, 'model', agent.model, 'model');

        for (const tool of [...new Set(agent.tools)].sort()) {
          addRelationship('usesTool', agent, 'tool', tool, 'tools');
        }

        for (const policy of [...new Set(agent.policies)].sort()) {
          addRelationship('governedBy', agent, 'policy', policy, 'policies');
        }

        if (agent.domain) addRelationship('belongsTo', agent, 'domain', agent.domain, 'domain');

        const url = agent.repository?.url;

        const repository =
          agent.repository?.id ?? (url ? repositoryId(url) : null) ?? options.repository;

        if (repository) {
          const repositoryResource = createRepositoryResource(repository);
          resources.set(resourceKey(repositoryResource.ref), repositoryResource);
          const evidence = evidenceFor(agent, 'repository');

          const defines: CatalogRelationship<'defines'> = {
            type: 'defines',
            from: repositoryResource.ref,
            to: resource.ref,
            ...evidence,
            source: resource.source,
          };

          relationships.set(relationshipKey(defines), defines);
        }
      } else if (entity.kind === 'tool') {
        const tool = entity;

        if (tool.domain) addRelationship('belongsTo', tool, 'domain', tool.domain, 'domain');
      } else if (entity.kind === 'workflow') {
        const workflow = entity;

        for (const agent of [...new Set(workflow.agents)].sort()) {
          addRelationship('orchestrates', workflow, 'agent', agent, 'agents');
        }

        if (workflow.domain) {
          addRelationship('belongsTo', workflow, 'domain', workflow.domain, 'domain');
        }
      } else if (entity.kind === 'eval') {
        const evaluation = entity;
        addRelationship('evaluates', evaluation, 'agent', evaluation.target, 'target');
      }
    }
  }

  for (const { link, to } of eventEdges?.edges ?? []) {
    const from = catalog.entities.get(link.from.kind)?.get(link.from.id);

    if (!from) continue;

    // Same direction the event catalog draws for services: a producer points at
    // the event, and the event points at whoever consumes it.
    const [start, end] =
      link.direction === 'produces' ? [entityRef(from), to] : [to, entityRef(from)];

    const relationship: CatalogRelationship = {
      type: link.direction,
      from: start,
      to: end,
      ...evidenceFor(from, link.direction),
      source: sourceOf(catalog, from),
    };

    relationships.set(relationshipKey(relationship), relationship);
  }

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...resources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, resource]) => resource),
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, relationship]) => relationship),
  };
}
