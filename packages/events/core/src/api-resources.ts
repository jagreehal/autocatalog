import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { architectureService, emptyResourceGraph } from './architecture';
import {
  CONSUMES_FILE,
  mergeConsumerGraph,
  readDeclarationsFile,
  shownName,
  withFields,
  type CallDeclaration,
} from './consumes';
import { isJsonObject, type JsonObject, type JsonValue } from './json';
import { derefLocal } from './json-ref';
import {
  relationshipKey,
  resourceKey,
  type ArchitectureCatalogResource,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';
import { findOpenApiDocuments, METHODS } from './scan-openapi';

const text = (value: JsonValue | undefined) => z.string().min(1).safeParse(value).data;

const objectAt = (doc: JsonObject, node: JsonValue | undefined): JsonObject => {
  const resolved = derefLocal<JsonValue | undefined>(doc, node);

  return isJsonObject(resolved) ? resolved : {};
};

export interface ApiOperation {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  deprecated: boolean;
  /** Whether every way to call it needs credentials, by its `security` or the document's. */
  secured: boolean;
}

/** A `security` list a caller cannot satisfy without credentials: no empty alternative. */
const requiresCredentials = (security: JsonValue | undefined) =>
  Array.isArray(security) &&
  security.length > 0 &&
  security.every((requirement) => isJsonObject(requirement) && Object.keys(requirement).length > 0);

/** An operation's name in the catalog, which drift and consumers share. */
export const endpointId = ({ method, path }: Pick<ApiOperation, 'method' | 'path'>) =>
  `${method} ${path}`;

/**
 * Each operation in path order, as the reference lists them. A `$ref` that does
 * not resolve costs only what it stands for, and `onProblem` is told: one bad
 * path must not take the rest of a spec, or a catalog, with it.
 */
export function apiOperations(
  doc: JsonObject,
  onProblem: (message: string) => void = () => undefined,
): ApiOperation[] {
  const read = (node: JsonValue | undefined, where: string): JsonObject => {
    try {
      return objectAt(doc, node);
    } catch (error) {
      onProblem(`${where}: ${error instanceof Error ? error.message : String(error)}`);

      return {};
    }
  };

  return Object.entries(read(doc.paths, 'paths')).flatMap(([path, item]) => {
    const pathItem = read(item, path);

    return METHODS.flatMap((method) => {
      const operation = pathItem[method];

      if (!isJsonObject(operation)) return [];

      const operationId = text(operation.operationId);
      const summary = text(operation.summary);

      return [
        {
          method: method.toUpperCase(),
          path,
          ...(operationId && { operationId }),
          ...(summary && { summary }),
          deprecated: operation.deprecated === true,
          secured: requiresCredentials(operation.security ?? doc.security),
        },
      ];
    });
  });
}

/** A service name a page can be made for: no path, no markup. */
const SERVICE_NAME = /^[A-Za-z0-9][\w.-]{0,199}$/;

const namedService = (doc: JsonObject) => {
  const extension = doc['x-autocatalog'];

  return isJsonObject(extension) ? text(extension.service) : undefined;
};

/** The service a spec names as serving it, in its top-level `x-autocatalog`, when it is a usable name. */
export function declaredApiService(doc: JsonObject): string | undefined {
  const name = namedService(doc);

  return name && SERVICE_NAME.test(name) ? name : undefined;
}

/** What is wrong with the service a spec names, when something is. */
export function apiServiceProblem(doc: JsonObject): string | undefined {
  const name = namedService(doc);

  return name && !SERVICE_NAME.test(name)
    ? `x-autocatalog.service ${shownName(name)} is not a service name: use letters, digits, . _ and -`
    : undefined;
}

/** An OpenAPI document a repository commits. */
export interface RepositoryApi {
  repository: string;
  /** Its spec's path under contracts/, as one slug: unique within the repository. */
  name: string;
  /** Where the repository keeps it, from the repository's root. */
  file: string;
  document: JsonObject;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Where the scan looks for contracts, and so where a published spec lives. */
const CONTRACTS = 'contracts';

/**
 * The OpenAPI 3 documents a repository commits under contracts/, read by the
 * same scan that turns their webhooks into events. A spec that fails to parse
 * goes to `warn`, and the rest of the repository still publishes.
 */
export async function publishedApis(
  repository: string,
  repositoryRoot: string,
  warn: (message: string) => void,
): Promise<RepositoryApi[]> {
  const root = path.join(repositoryRoot, CONTRACTS);

  // A real directory only: a symlink could point anywhere on the build machine,
  // and the spec gets published.
  if (!fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];

  const { documents, errors } = await findOpenApiDocuments({ root });

  for (const error of errors) warn(`${repository}: ${CONTRACTS}/${error}`);

  // Named from the path without its extension; specs that share that name keep
  // the extension, then a number, so each one gets its own page.
  const bare = (relFile: string) => slug(relFile.replace(/\.(ya?ml|json)$/i, ''));

  const shared = new Set(
    documents.map(({ relFile }) => bare(relFile)).filter((name, i, all) => all.indexOf(name) !== i),
  );

  const taken = new Set<string>();

  return [...documents]
    .sort((a, b) => a.relFile.localeCompare(b.relFile))
    .map(({ relFile, doc }) => {
      let name = shared.has(bare(relFile)) ? slug(relFile) : bare(relFile);

      for (let n = 2; taken.has(name); n += 1) name = `${slug(relFile)}-${n}`;
      taken.add(name);

      return { repository, name, file: `${CONTRACTS}/${relFile}`, document: doc };
    });
}

export interface PublishedApi extends RepositoryApi {
  /** The services that serve it. */
  services: string[];
  /** Where the API's page lives, relative to the site's base. */
  url?: string;
}

/**
 * The path part of each `servers` URL, which a server's routes carry and a
 * spec's paths do not; `''` for a server at the root.
 */
function basePathsOf(doc: JsonObject): string[] {
  const servers = Array.isArray(doc.servers) ? doc.servers : [];

  const paths = servers.flatMap((server) => {
    const url = isJsonObject(server) ? text(server.url) : undefined;

    return url === undefined
      ? []
      : [url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/\/+$/, '')];
  });

  return [...new Set(paths)];
}

/** One endpoint per operation, each exposed by the services that serve the API. */
export function createEndpointGraph(
  api: PublishedApi,
  onProblem?: (message: string) => void,
): ResourceGraph {
  const declared = declaredApiService(api.document);
  const info = isJsonObject(api.document.info) ? api.document.info : {};
  const title = text(info.title);
  const version = text(info.version);
  const basePaths = basePathsOf(api.document);

  const resources: ArchitectureCatalogResource[] = [];
  const relationships: CatalogRelationship[] = [];

  for (const operation of apiOperations(api.document, onProblem)) {
    const { operationId, summary, method, path, deprecated, secured } = operation;

    const ref: ResourceRef<'endpoint'> = {
      kind: 'endpoint',
      namespace: `${api.repository}/${api.name}`,
      id: endpointId(operation),
    };

    const source = {
      repo: api.repository,
      file: api.file,
      ...(operationId && { symbol: operationId }),
    };

    resources.push({
      ref,
      title: ref.id,
      ...(summary && { summary }),
      ...(api.url && { url: api.url }),
      tags: [],
      provenance: { default: 'extracted', fields: {} },
      needsReview: false,
      source,
      attributes: {
        method,
        path,
        deprecated,
        secured,
        ...(operationId && { operationId }),
        ...(title && { api: title }),
        ...(version && { apiVersion: version }),
        ...(basePaths.length > 0 && { basePaths }),
      },
    });

    for (const service of api.services)
      relationships.push({
        type: 'exposedBy',
        from: ref,
        to: { kind: 'service', id: service },
        provenance: declared ? 'declared' : 'inferred',
        // One line in the spec settles every operation, so an inferred link
        // says so through its provenance and does not queue one review each.
        needsReview: false,
        source,
      });
  }

  return {
    ...emptyResourceGraph(),
    resources: [...resources, ...api.services.map(architectureService)],
    relationships,
  };
}

export const endpointFacts = z.object({
  method: z.string(),
  path: z.string(),
  basePaths: z.array(z.string()).default([]),
  secured: z.boolean().default(false),
});

/** The endpoints each service exposes, by service id. */
export function endpointsByService(graph: ResourceGraph): Map<string, CatalogResource[]> {
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));
  const exposed = new Map<string, CatalogResource[]>();

  for (const { type, from, to } of graph.relationships) {
    const endpoint = byKey.get(resourceKey(from));

    if (type === 'exposedBy' && endpoint?.ref.kind === 'endpoint' && to.kind === 'service')
      exposed.set(to.id, [...(exposed.get(to.id) ?? []), endpoint]);
  }

  return exposed;
}

/** A route as compared: `{id}` and `:id` are the same parameter, whatever it is called. */
const comparableRoute = (route: string) =>
  route.replace(/\{[^}]*\}|(?<=\/):[^/]+/g, '{}').replace(/(?<=.)\/+$/, '');

/** Whether `operation` names this endpoint, as written or below a server's base path. */
function isOperation(endpoint: CatalogResource, operation: string): boolean {
  const facts = endpointFacts.safeParse(endpoint.attributes);

  if (!facts.success) return false;

  const { method, path, basePaths } = facts.data;
  const [called, ...route] = operation.split(' ');

  return (
    called === method &&
    ['', ...basePaths].some(
      (base) => comparableRoute(`${base}${path}`) === comparableRoute(route.join(' ')),
    )
  );
}

/**
 * The graph with the calls linkEndpointCalls returned. A declared call to an
 * endpoint replaces the same call already there, which arrived without the
 * owner check and so without fields: the checked declaration is the word on
 * what the caller reads. Everything else only fills gaps.
 */
export function withLinkedCalls(graph: ResourceGraph, linked: ResourceGraph): ResourceGraph {
  const replaced = new Set(
    linked.relationships.flatMap((edge) =>
      edge.type === 'calls' && edge.to.kind === 'endpoint' && edge.provenance === 'declared'
        ? [relationshipKey(edge)]
        : [],
    ),
  );

  return mergeConsumerGraph(
    {
      ...graph,
      relationships: graph.relationships.filter((edge) => !replaced.has(relationshipKey(edge))),
    },
    linked,
  );
}

/**
 * The graph with no fields on any call to an endpoint. Only a declaration whose
 * repository owns the caller may narrow what it reads, and linkEndpointCalls
 * is what checks that; a call that arrived any other way, in a repository's
 * resource graph or a joined index, may read anything.
 */
export function withoutCallerFields(graph: ResourceGraph): ResourceGraph {
  return {
    ...graph,
    relationships: graph.relationships.map((edge) => {
      if (edge.type !== 'calls' || edge.to.kind !== 'endpoint' || !edge.attributes?.fields)
        return edge;

      const { fields: _fields, ...attributes } = edge.attributes;

      return { ...edge, attributes };
    }),
  };
}

export interface EndpointCallOptions {
  /** Each service's owning repository, from the lock: the only word on ownership when given. */
  owners?: ReadonlyMap<string, string> | undefined;
}

/** {@link linkEndpointCalls}'s answer. */
export interface LinkedEndpointCalls {
  graph: ResourceGraph;
  /** What could not be joined to an endpoint, in words. */
  unresolved: string[];
  /** Fields that wait for a lock to say who owns their service, in words. */
  unverified: string[];
}

export interface RepositoryCalls {
  repository: string;
  calls: CallDeclaration[];
}

/**
 * Who calls each endpoint: what repositories declare, then the operations
 * traces saw on a service-to-service `calls` edge. An edge only ever joins an
 * endpoint its target exposes; a declaration naming none is said, and so is a
 * traced route that is not exactly one endpoint, which stays a call between
 * services. A declared edge stands over a traced one, because it says what the
 * caller reads. A traced edge carries no counts: those are per service pair.
 */
export function linkEndpointCalls(
  composed: ResourceGraph,
  repositories: RepositoryCalls[],
  options: EndpointCallOptions = {},
): LinkedEndpointCalls {
  const exposed = endpointsByService(composed);

  const known = new Set(composed.relationships.map(relationshipKey));

  // The lock is the only word on who owns a service: what a repository writes
  // about itself is a claim anyone could make.
  const ownedBy = (service: string, repository: string) =>
    options.owners?.get(service) === repository;

  const unverified = new Set<string>();
  const unowned = new Set<string>();
  const edges = new Map<string, CatalogRelationship>();
  const callers = new Map<string, CatalogResource>();
  const unresolved: string[] = [];

  for (const { repository, calls } of repositories)
    for (const { service, target, operation, fields } of calls) {
      const all = exposed.get(target) ?? [];
      const picked = operation ? all.filter((e) => isOperation(e, operation)) : all;

      if (picked.length === 0)
        unresolved.push(
          `${repository}: ${CONSUMES_FILE}: ${service} calls ${[target, operation].flatMap((part) => (part ? [shownName(part)] : [])).join(' ')}, which nothing exposes`,
        );

      for (const endpoint of picked) {
        const edge: CatalogRelationship = {
          type: 'calls',
          from: { kind: 'service', id: service },
          to: endpoint.ref,
          provenance: 'declared',
          needsReview: false,
          source: { type: 'code', file: CONSUMES_FILE },
          // From anyone else, the call counts and the fields do not: a repository
          // must not narrow another team's service out of a drift gate.
          ...(fields && ownedBy(service, repository) && { attributes: { fields: [...fields] } }),
        };

        if (fields && !options.owners) unverified.add(service);
        else if (fields && !ownedBy(service, repository)) unowned.add(`${repository}: ${service}`);

        const key = relationshipKey(edge);
        const earlier = edges.get(key);

        edges.set(key, earlier ? withFields(earlier, edge) : edge);
        callers.set(service, architectureService(service));
      }

      if (picked.length === 0) continue;

      // The call between the services too, which is what a map draws.
      const between: CatalogRelationship = {
        type: 'calls',
        from: { kind: 'service', id: service },
        to: { kind: 'service', id: target },
        provenance: 'declared',
        needsReview: false,
        source: { type: 'code', file: CONSUMES_FILE },
      };

      if (!known.has(relationshipKey(between))) edges.set(relationshipKey(between), between);
    }

  for (const { type, from, to, evidence } of composed.relationships) {
    if (type !== 'calls' || from.kind !== 'service' || to.kind !== 'service') continue;

    const all = exposed.get(to.id);

    if (!all) continue;

    for (const operation of evidence?.operations ?? []) {
      const picked = all.filter((endpoint) => isOperation(endpoint, operation));
      const [endpoint] = picked;

      if (picked.length !== 1 || !endpoint) {
        unresolved.push(
          `${shownName(from.id)} calls ${shownName(to.id)} at ${shownName(operation)}, which is ${picked.length} of its endpoints`,
        );
        continue;
      }

      const edge: CatalogRelationship = {
        type: 'calls',
        from,
        to: endpoint.ref,
        provenance: 'observed',
        needsReview: false,
      };

      const key = relationshipKey(edge);

      if (!known.has(key) && !edges.has(key)) edges.set(key, edge);
    }
  }

  for (const caller of [...unowned].sort()) {
    const [repository, service] = caller.split(': ');

    unresolved.push(
      `${repository}: ${CONSUMES_FILE}: the fields declared for ${service} do not count, because the lock does not pin it to this repository; it may read anything`,
    );
  }

  return {
    graph: {
      ...emptyResourceGraph(),
      resources: [...callers.values()],
      relationships: [...edges.values()],
    },
    unresolved,
    unverified: [...unverified]
      .sort()
      .map(
        (service) =>
          `the fields ${service} reads count once ac federation lock pins its owner; until then it may read anything`,
      ),
  };
}

/**
 * A graph with each repository's APIs in it, for a reader that has no site: the
 * spec's service, else one the graph has whose name its title gives. What
 * cannot be read or joined goes to `onProblem`, its repository first.
 */
export async function withEndpoints(
  composed: ResourceGraph,
  repositories: { repository: string; dir: string }[],
  onProblem: (message: string) => void,
  options: EndpointCallOptions & {
    /** Told about fields that wait for a lock; `onProblem` when not given. */
    onUnverified?: (message: string) => void;
  } = {},
): Promise<ResourceGraph> {
  let graph = withoutCallerFields(composed);

  const calls: RepositoryCalls[] = [];

  for (const { repository, dir } of repositories) {
    for (const api of await publishedApis(repository, dir, onProblem)) {
      const declared = declaredApiService(api.document);
      const title = text(objectAt(api.document, api.document.info).title) ?? '';

      const named = graph.resources.flatMap(({ ref }) =>
        ref.kind === 'service' && slug(ref.id) === slug(title).replace(/-api$/, '') ? [ref.id] : [],
      );

      // With a lock, a spec serves only a service the lock pins to its repository.
      const unpinned = declared && options.owners && options.owners.get(declared) !== repository;

      if (unpinned)
        onProblem(
          `${repository}: ${api.file}: x-autocatalog.service names ${declared}, which the lock does not pin to this repository, so no service exposes its operations`,
        );

      graph = mergeConsumerGraph(
        graph,
        createEndpointGraph(
          {
            ...api,
            // A service guessed from the title is held to the lock the same way.
            services: unpinned
              ? []
              : declared
                ? [declared]
                : named.filter(
                    (service) => !options.owners || options.owners.get(service) === repository,
                  ),
          },
          (message) => onProblem(`${repository}: ${api.file}: ${message}`),
        ),
      );
    }

    try {
      calls.push({ repository, calls: (await readDeclarationsFile(dir)).calls });
    } catch (error) {
      onProblem(`${repository}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const linked = linkEndpointCalls(graph, calls, options);

  linked.unresolved.forEach(onProblem);
  linked.unverified.forEach(options.onUnverified ?? onProblem);

  return withLinkedCalls(graph, linked.graph);
}
