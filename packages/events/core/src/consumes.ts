import path from 'node:path';
import { z } from 'zod';
import { architectureService } from './architecture';
import { fieldPaths } from './fields';
import type { JsonObject } from './json';
import { readOptionalResourceJson } from './resource-files';
import {
  AUTOCATALOG_GRAPH_SPEC,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';

/**
 * Where a repository says which other teams' events its services consume. The
 * producing team never has to list them: the company site joins these files
 * up, and `ac drift --consumers` reads them back in the producer's pull request.
 */
export const CONSUMES_FILE = 'autocatalog.consumes.json';

/**
 * A consumer name from another repository or from runtime evidence, safe to
 * print: it lands in terminal output, Markdown posted to a pull request and
 * GitHub annotations, where a newline, link, image or `@team` mention would
 * be injected. Names keep to letters, digits, spaces and `. _ : / -`.
 */
const SAFE_NAME = /^[A-Za-z0-9][\w .:/-]{0,199}$/;

/** An event as `domain/id`, each part under the same rule as a name. */
const EVENT_NAME = /^[A-Za-z0-9][\w.:-]{0,199}\/[A-Za-z0-9][\w.:-]{0,199}$/;

/** A payload path such as `amount` or `items[].sku`, under the same rule. */
const FIELD_PATH = /^[\w$][\w$.[\]-]{0,199}$/;

export const isSafeName = (name: string): boolean => SAFE_NAME.test(name);

/**
 * How a consumer whose name is not safe to print is counted, so the gate still
 * names it as reached by a change.
 */
export const UNSAFE_CONSUMER = 'a consumer whose name is not safe to print';

/** A rejected name as it can be shown: escaped, so the report stays one line. */
export const shownName = (name: string): string => JSON.stringify(name).slice(1, -1);

const consumerDeclaration = z.strictObject({
  service: z.string().regex(SAFE_NAME, 'use letters, digits, spaces and . _ : / -'),
  // `domain/id`, as the site and AI agents name an event.
  event: z.string().regex(EVENT_NAME, 'name the event as domain/id'),
  /** Payload paths the service reads, such as `amount` or `items[].sku`. */
  fields: z.array(z.string().regex(FIELD_PATH, 'a payload path such as items[].sku')).optional(),
});

const consumesFile = z.strictObject({ consumes: z.array(consumerDeclaration) });

export type ConsumerDeclaration = z.infer<typeof consumerDeclaration>;

/** The repository's {@link CONSUMES_FILE}, or nothing when it has none. */
export async function readConsumerDeclarations(root: string): Promise<ConsumerDeclaration[]> {
  const value = await readOptionalResourceJson(path.join(root, CONSUMES_FILE), { root });

  if (value === undefined) return [];

  const parsed = consumesFile.safeParse(value);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    throw new Error(
      `${CONSUMES_FILE}: ${issue?.path.length ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'invalid'}`,
    );
  }

  return parsed.data.consumes;
}

/** An Event resource as the composed graph holds it, with the repository that publishes it. */
export interface PublishedEvent {
  ref: ResourceRef;
  domain: string;
  id: string;
  repository?: string;
}

export class ConsumerGraphError extends Error {
  constructor(public readonly failures: string[]) {
    super(failures.join('; '));
    this.name = 'ConsumerGraphError';
  }
}

/**
 * One repository's declarations as edges onto the exact Event resources that
 * other repositories publish. An id is unique inside a domain, not across a
 * company: when two repositories publish one `domain/id`, this repository's own
 * copy wins, and with none the reference is ambiguous rather than guessed.
 */
export function createConsumerResourceGraph(
  declarations: ConsumerDeclaration[],
  options: { repository?: string; events: PublishedEvent[] },
): ResourceGraph {
  const candidates = new Map<string, PublishedEvent[]>();

  for (const event of options.events) {
    const key = `${event.domain}/${event.id}`;
    candidates.set(key, [...(candidates.get(key) ?? []), event]);
  }

  const failures: string[] = [];
  const services = new Map<string, ResourceGraph['resources'][number]>();
  const relationships = new Map<string, CatalogRelationship>();

  for (const declaration of declarations) {
    const all = candidates.get(declaration.event) ?? [];
    const local = all.filter((event) => event.repository === options.repository);
    const pick = local.length > 0 ? local : all;
    const [published] = pick;

    if (pick.length !== 1 || !published) {
      const repositories = pick.map((event) => event.repository ?? '(unnamed)').sort();

      failures.push(
        pick.length === 0
          ? `${CONSUMES_FILE}: ${declaration.service} consumes ${declaration.event}, which no repository publishes`
          : `${CONSUMES_FILE}: ${declaration.service} consumes ${declaration.event}, which ${pick.length} repositories publish (${repositories.join(', ')})`,
      );
      continue;
    }

    const service = architectureService(declaration.service);
    services.set(resourceKey(service.ref), service);

    const relationship: CatalogRelationship = {
      type: 'consumes',
      from: published.ref,
      to: service.ref,
      provenance: 'declared',
      needsReview: false,
      source: { type: 'code', file: CONSUMES_FILE },
      ...(declaration.fields && { attributes: { fields: [...declaration.fields] } }),
    };

    const key = relationshipKey(relationship);
    const earlier = relationships.get(key);

    relationships.set(key, earlier ? withFields(earlier, relationship) : relationship);
  }

  if (failures.length > 0) throw new ConsumerGraphError(failures);

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...services.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, resource]) => resource),
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, relationship]) => relationship),
  };
}

/** {@link consumersFromGraph}'s answer. */
export interface GraphConsumers {
  /** By `domain/id`. */
  consumers: Map<string, EventConsumers>;
  /** Events two repositories publish, when it could not tell which is ours, escaped; every copy's consumers count. */
  ambiguous: string[];
  /** Names not safe to print, escaped; each consumer is counted as {@link UNSAFE_CONSUMER}. */
  rejected: string[];
}

const declaredFields = (edge: CatalogRelationship): string[] | undefined =>
  edgeFields.parse(edge.attributes).fields;

/**
 * Two declarations of one consumer reading one event, as one edge. The fields
 * add up; one that names none says it may read anything, so the edge then
 * names none, and every change to the event reaches it.
 */
function withFields(earlier: CatalogRelationship, later: CatalogRelationship): CatalogRelationship {
  const before = declaredFields(earlier);
  const after = declaredFields(later);
  const { attributes: _attributes, ...edge } = earlier;

  return before && after
    ? { ...edge, attributes: { fields: [...new Set([...before, ...after])] } }
    : edge;
}

/**
 * A repository's declarations joined to the graph the site has composed so
 * far. A service or edge already there stays as it is; a declaration only adds
 * consumers, and fields for the consumers nobody else describes.
 */
export function mergeConsumerGraph(graph: ResourceGraph, fragment: ResourceGraph): ResourceGraph {
  const resources = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  for (const resource of fragment.resources)
    if (!resources.has(resourceKey(resource.ref)))
      resources.set(resourceKey(resource.ref), resource);

  const relationships = new Map(graph.relationships.map((edge) => [relationshipKey(edge), edge]));

  for (const edge of fragment.relationships) {
    const key = relationshipKey(edge);
    const existing = relationships.get(key);

    // Any repository can name any service, so a declaration never narrows a
    // consumer the producer's own manifest lists: the producer's word on what
    // it reads stands. Declarations of one consumer combine.
    if (!existing) relationships.set(key, edge);
    else if (existing.source?.file === CONSUMES_FILE)
      relationships.set(key, withFields(existing, edge));
  }

  return {
    ...graph,
    resources: [...resources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, resource]) => resource),
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, edge]) => edge),
  };
}

export interface EventConsumers {
  consumers: string[];
  /** Payload paths each consumer says it reads, by consumer name. */
  fields: Record<string, string[]>;
}

const edgeFields = z
  .object({ fields: z.array(z.string()) })
  .partial()
  .catch({});

const eventDomain = z.object({ domain: z.string() }).catch({ domain: '' });

/** A published event, as the company graph names it. */
interface GraphEventEntry {
  /** `domain/id`. */
  key: string;
  domain: string;
  id: string;
  /** The repository that publishes it, from the event's `repository/domain` namespace. */
  repository: string;
}

/** Each event in a company graph, by resource key. */
function publishedEvents(graph: ResourceGraph): Map<string, GraphEventEntry> {
  const events = new Map<string, GraphEventEntry>();

  for (const resource of graph.resources) {
    if (resource.ref.kind !== 'event') continue;

    const { domain } = eventDomain.parse(resource.attributes);

    // `domain/id` is the key, so a part holding a slash could stand for another event.
    if (!/^[^/\s]+$/.test(domain) || !/^[^/\s]+$/.test(resource.ref.id)) continue;

    const namespace = resource.ref.namespace ?? '';

    const repository = namespace.endsWith(`/${domain}`)
      ? namespace.slice(0, -domain.length - 1)
      : '';

    events.set(resourceKey(resource.ref), {
      key: `${domain}/${resource.ref.id}`,
      domain,
      id: resource.ref.id,
      repository,
    });
  }

  return events;
}

/**
 * Who consumes each event, by `domain/id`, from a company graph such as the
 * site's `/catalog.json`. The graph names its events per repository; when two
 * repositories publish the same `domain/id`, `repository` says which one is
 * ours. Without it the event is listed as ambiguous, and the consumers of
 * every copy count.
 */
export function consumersFromGraph(
  graph: ResourceGraph,
  options: { repository?: string } = {},
): GraphConsumers {
  const events = publishedEvents(graph);

  const publishers = new Map<string, Set<string>>();

  for (const { key, repository } of events.values())
    publishers.set(key, (publishers.get(key) ?? new Set()).add(repository));

  const consumers = new Map<string, EventConsumers>();
  // What each consumer of each event reads, by `domain/id`, as edges arrive.
  const reads = new Map<string, Map<string, Set<string> | 'anything'>>();
  const ambiguous = new Set<string>();
  const rejected = new Set<string>();

  for (const edge of graph.relationships) {
    if (edge.type !== 'consumes' || edge.from.kind !== 'event') continue;

    const event = events.get(resourceKey(edge.from));

    if (!event) continue;

    // With this repository named among the publishers, another copy's
    // consumers are that copy's. Without it, every copy's consumers count:
    // another repository publishing the same event must not hide them.
    const all = publishers.get(event.key) ?? new Set();
    const pinned = Boolean(options.repository && all.has(options.repository));

    if (pinned && event.repository !== options.repository) continue;

    if (!pinned && all.size > 1) ambiguous.add(event.key);

    const safeName = isSafeName(edge.to.id);
    const name = safeName ? edge.to.id : UNSAFE_CONSUMER;

    if (!safeName) rejected.add(shownName(edge.to.id));

    const { fields } = edgeFields.parse(edge.attributes);
    const usage = reads.get(event.key) ?? new Map<string, Set<string> | 'anything'>();
    const before = usage.get(name);

    // No fields, or a path that cannot be trusted, means it may read anything,
    // and that wins over fields another edge names: a filtered list would read
    // as "reads none of these", and the gate would pass a break.
    usage.set(
      name,
      !safeName ||
        !fields ||
        !fields.every((field) => FIELD_PATH.test(field)) ||
        before === 'anything'
        ? 'anything'
        : new Set([...(before ?? []), ...fields]),
    );
    reads.set(event.key, usage);
  }

  for (const [key, usage] of reads)
    consumers.set(key, {
      consumers: [...usage.keys()].sort(),
      fields: Object.fromEntries(
        [...usage].flatMap(([name, read]) => (read === 'anything' ? [] : [[name, [...read]]])),
      ),
    });

  return {
    consumers,
    ambiguous: [...ambiguous].map(shownName).sort(),
    rejected: [...rejected].sort(),
  };
}

/**
 * A consumer's declarations against what the producers publish: the event must
 * exist, and each field it says it reads must be in that event's schema. A
 * schema that cannot be read fails the declaration rather than passing it.
 */
export async function checkConsumerDeclarations(
  declarations: ConsumerDeclaration[],
  graph: ResourceGraph,
  loadSchema: (event: { repository: string; domain: string; id: string }) => Promise<JsonObject>,
): Promise<string[]> {
  const byKey = new Map<string, GraphEventEntry[]>();

  for (const entry of publishedEvents(graph).values())
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);

  const problems: string[] = [];
  const schemas = new Map<string, Promise<JsonObject>>();

  for (const { service, event, fields } of declarations) {
    const publishers = byKey.get(event) ?? [];
    const [publisher] = publishers;

    if (!publisher) {
      problems.push(`${service} consumes ${event}, which no repository publishes`);
      continue;
    }

    if (publishers.length > 1) {
      const names = publishers.map((entry) => shownName(entry.repository)).sort();

      problems.push(
        `${service} consumes ${event}, which ${names.length} repositories publish (${names.join(', ')})`,
      );
      continue;
    }

    if (!fields?.length) continue;

    const key = `${publisher.repository}/${publisher.key}`;

    let pending = schemas.get(key);

    if (!pending) {
      pending = loadSchema(publisher);
      schemas.set(key, pending);
    }

    let published: Set<string>;

    try {
      published = fieldPaths(await pending);
    } catch (error) {
      problems.push(
        `${service} consumes ${event}: its schema could not be read (${shownName(error instanceof Error ? error.message : String(error))})`,
      );
      continue;
    }

    for (const field of fields)
      if (!published.has(field))
        problems.push(
          `${service} reads \`${field}\` of ${event}, which ${shownName(publisher.repository)} does not publish`,
        );
  }

  return problems;
}
