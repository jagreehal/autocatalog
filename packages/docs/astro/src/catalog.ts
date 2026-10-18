import fs from 'node:fs';
import path from 'node:path';
import {
  createAgentsResourceGraph,
  loadCatalog as loadAgentsCatalog,
  type GraphEvent,
} from 'autocatalog-agents-core';
import {
  AUTOCATALOG_GRAPH_SPEC,
  assertPathSegment,
  buildServices,
  createEventResourceGraph,
  createResourceGraphComposer,
  isEventCatalogResource,
  loadRepositoryEvents,
  isSingleRepository,
  publishesCatalogContent,
  resourceKey,
  type LoadedEvent,
  summarizeResourceGraph,
  type CatalogResource,
  type ResourceGraph,
  type ResourceGraphSummary,
  type ResourceRef,
  readResourceGraph,
  mergeArchitectureGraphs,
  architectureConflicts,
  relationshipKey,
  isJsonObject,
  CONSUMES_FILE,
  createConsumerResourceGraph,
  mergeConsumerGraph,
  readConsumerDeclarations,
  RESOURCE_GRAPH_FILE,
  architectureConfig,
  loadCodeowners,
  readOptionalResourceJson,
  resolveResourceOwnership,
  scanModelResources,
  type CatalogRelationship,
  type JsonValue,
} from 'autocatalog-core';
import {
  buildDocsManifest,
  createDescribesRelationships,
  createDocsResourceGraph,
  DocsManifestError,
  headCommit,
  readDocs,
  resolveDocKinds,
  resolveDocsLayout,
  type BuildDocsManifestOptions,
  type Doc,
  type DocKind,
  type DocsManifest,
} from 'autocatalog-docs-core';
import { repositoryApis, type CatalogApi } from './apis';
import { publishedKinds, RESERVED_SEGMENTS } from './kinds';
import { catalogModels, modelPath, type CatalogModel } from './data-models';
import { docsSiteConfig } from './config';
import type { ShellLink } from './shell';
import { catalogHref } from './view';

/** A repository whose own catalog would not compile, and why. */
export interface RepositoryFailure {
  repository: string;
  /** Which convention failed to compile: the repository's events, agents or API specs, or its name. */
  source: 'events' | 'agents' | 'resources' | 'consumers' | 'apis' | 'name';
  message: string;
}

/** A current event, with the repository that published it. */
export interface CatalogEvent {
  repository: string;
  event: LoadedEvent;
}

export interface DocsCatalog {
  docs: Doc[];
  /** Current events from every repository whose catalog compiled, for their pages. */
  events: CatalogEvent[];
  /**
   * Earlier versions, for their history pages: a committed catalog's
   * `versioned/` folders, or the declared versions in the history of
   * discovered contracts.
   */
  history: CatalogEvent[];
  /** The OpenAPI documents each repository commits, each with a reference page. */
  apis: CatalogApi[];
  /** The tables and collections each repository defines, each with a page. */
  models: CatalogModel[];
  manifest: DocsManifest;
  /** The document kinds with at least one document, each with an index page. */
  kinds: DocKind[];
  graph: ResourceGraph;
  summary: ResourceGraphSummary;
  /** Repositories quarantined from the graph, shown rather than swallowed. */
  failures: RepositoryFailure[];
  /**
   * What the build must say out loud: each quarantine, and each `about:` target
   * left out. Returned rather than printed, because one build compiles the
   * catalog more than once (configuration, then prerender), and a warning
   * repeated reads as two problems.
   */
  warnings: string[];
}

export interface BuildDocsCatalogOptions extends BuildDocsManifestOptions {
  /** Repository identity, when the id namespace is not the repository's name. */
  repository?: string;
}

export function repositoryRoots(root: string, docs: Doc[], repo?: string): Map<string, string> {
  const layout = resolveDocsLayout(root, { repo });

  if (layout.single || isSingleRepository(root)) {
    const name = repo ?? docs[0]?.repo ?? path.basename(path.resolve(root));

    return new Map([[name, layout.single ? layout.root : path.resolve(root)]]);
  }

  const roots = new Map<string, string>();

  for (const entry of fs.readdirSync(layout.root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const repositoryRoot = path.join(layout.root, entry.name);

    if (publishesCatalogContent(repositoryRoot)) roots.set(entry.name, repositoryRoot);
  }

  return roots;
}

/**
 * Build the one graph the documentation site publishes. Filesystem layout is
 * the Adapter: sibling `<repo>/docs` and `<repo>/events` roots join through the
 * same inferred Repository resource, without fuzzy name matching.
 */
export async function buildDocsCatalog(
  root: string,
  options: BuildDocsCatalogOptions = {},
): Promise<DocsCatalog> {
  const docs = readDocs(root, options);
  const manifest = documentsManifest(root, options);

  const composer = createResourceGraphComposer();

  const docsGraph = createDocsResourceGraph(docs, manifest, { repository: options.repository });
  composer.add(docsGraph);

  // Which repositories declared each resource and relationship, so one
  // repository's resources.json can add to another's facts but not rewrite them.
  const declarations = new Map<string, Set<string>>();
  claim(declarations, 'docs/', docsGraph);

  const failures: RepositoryFailure[] = [];

  const resourceFragments: Array<{
    repository: string;
    repositoryRoot: string;
    graph: ResourceGraph;
  }> = [];

  const events: CatalogEvent[] = [];
  const history: CatalogEvent[] = [];
  const apis: CatalogApi[] = [];

  // Compiled per repository, and a repository that will not compile is
  // quarantined rather than allowed to fail everyone's build. The refusal to
  // publish something partial still applies — it applies in the repository that
  // owns the mistake, where `ac docs check` and `ac validate` gate the merge.
  // Here the honest answer is to show which repository is missing and why.
  // A fragment contradicting one composed before it is quarantined the same
  // way: the later repository is left out, never the whole site.
  const quarantine = async (
    repository: string,
    source: RepositoryFailure['source'],
    compile: () => Promise<ResourceGraph>,
  ): Promise<ResourceGraph | undefined> => {
    try {
      const graph = await compile();
      composer.add(graph);
      claim(declarations, repository, graph);

      return graph;
    } catch (error) {
      failures.push({
        repository,
        source,
        message: error instanceof Error ? error.message : String(error),
      });

      return undefined;
    }
  };

  // Sorted, so which of two contradicting repositories is quarantined does not
  // depend on the order the filesystem lists them in.
  const found = [...repositoryRoots(root, docs, options.repo)]
    .map(([repository, repositoryRoot]) => ({
      name: options.repository ?? repository,
      repositoryRoot,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A repository's name is the first segment of its pages' addresses, so one
  // named like a page the site already has is left out until it is renamed.
  const repositories = found.filter(({ name }) => !RESERVED_SEGMENTS.has(name));

  for (const { name } of found)
    if (RESERVED_SEGMENTS.has(name))
      failures.push({
        repository: name,
        source: 'name',
        message: `/${name}/ is one of the site's own pages; rename the repository's folder to publish it`,
      });

  const kinds = publishedKinds(
    resolveDocKinds(root, options.conventionsPath).kinds,
    manifest,
    new Set([...docs.map((doc) => doc.repo), ...repositories.map(({ name }) => name)]),
  );

  // Every repository's events first, so an agent in one repository can name an
  // event another publishes and the edge lands on that exact Event resource.
  const graphEvents: GraphEvent[] = [];
  // Left out of a repository without quarantining it, such as an unreadable snapshot.
  const notes: string[] = [];

  for (const { name, repositoryRoot } of repositories) {
    try {
      const resourceGraph =
        (await readResourceGraph(repositoryRoot)) ??
        (await scannedModels(repositoryRoot, name, notes));

      if (resourceGraph)
        resourceFragments.push({ repository: name, repositoryRoot, graph: resourceGraph });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      failures.push({
        repository: name,
        source: 'resources',
        // The reader names the file and what is wrong with it.
        message,
      });
    }

    const eventsRoot = path.join(repositoryRoot, 'events');
    let loaded: LoadedEvent[] = [];

    const graph = await quarantine(name, 'events', async () => {
      loaded = await loadRepositoryEvents(repositoryRoot, {
        history: true,
        onWarning: (message) => notes.push(`${name}: ${message}`),
      });
      assertPathSegment(repositoryRoot, 'repository', name);
      loaded.forEach(assertRouteSegments);

      // Services are inferred from producers and consumers, and each gets a page.
      for (const service of buildServices(loaded).values()) {
        assertPathSegment(eventsRoot, 'service', service.name);
      }

      return createEventResourceGraph(loaded, { repository: name, urls: false });
    });

    // Kept only once the repository composed, so a quarantined catalog has no
    // pages either.
    if (!graph) continue;

    for (const event of loaded) {
      (event.folder.isVersioned ? history : events).push({ repository: name, event });
    }

    for (const resource of graph.resources.filter(isEventCatalogResource)) {
      graphEvents.push({
        ref: resource.ref,
        domain: resource.attributes.domain,
        id: resource.ref.id,
        repository: name,
      });
    }
  }

  const quarantined = new Set(
    failures.flatMap((failure) => (failure.source === 'events' ? [failure.repository] : [])),
  );

  for (const { name, repositoryRoot } of repositories) {
    if (!quarantined.has(name)) {
      try {
        assertPathSegment(repositoryRoot, 'repository', name);
        apis.push(
          ...(await repositoryApis(name, repositoryRoot, (message) => notes.push(message))),
        );
      } catch (error) {
        failures.push({
          repository: name,
          source: 'apis',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (fs.existsSync(path.join(repositoryRoot, 'agents'))) {
      await quarantine(name, 'agents', async () =>
        createAgentsResourceGraph(await loadAgentsCatalog(repositoryRoot), {
          repository: name,
          urls: false,
          events: graphEvents,
        }),
      );
    }
  }

  // What a repository says it consumes of the events every repository publishes,
  // so a producer elsewhere learns who it would break. Merged rather than
  // composed: a service or edge the producer's events already name is the same
  // one, and the declaration adds only what is missing.
  const consumerFragments: ResourceGraph[] = [];

  for (const { name, repositoryRoot } of repositories) {
    if (!fs.existsSync(path.join(repositoryRoot, CONSUMES_FILE))) continue;

    try {
      consumerFragments.push(
        createConsumerResourceGraph(await readConsumerDeclarations(repositoryRoot), {
          repository: name,
          events: graphEvents,
        }),
      );
    } catch (error) {
      failures.push({
        repository: name,
        source: 'consumers',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Drawn once every Adapter has composed, because a document may be about
  // anything they define. One naming nothing here — a typo, or a repository
  // quarantined above — is left out and said out loud; `ac docs check` is what
  // fails the merge for it.
  let composed = composer.graph();
  // The repository each table and collection is read from, for its page.
  const modelRepositories = new Map<string, { repository: string; repositoryRoot: string }>();

  for (const fragment of resourceFragments) {
    try {
      const guarded = guardFragment(composed, fragment, declarations);
      // Merging keeps one side of a contested schema or owner for review, which
      // is right inside one repository's scan and wrong across repositories.
      const contested = architectureConflicts(composed, guarded);

      if (contested.length) throw new Error(`${RESOURCE_GRAPH_FILE}: ${contested.join('; ')}`);
      composed = mergeArchitectureGraphs(composed, guarded);
      claim(declarations, fragment.repository, fragment.graph, { declaredOnly: true });

      for (const resource of fragment.graph.resources) {
        const key = resourceKey(resource.ref);

        if (!modelRepositories.has(key)) modelRepositories.set(key, fragment);
      }
    } catch (error) {
      failures.push({
        repository: fragment.repository,
        source: 'resources',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Last, so a declaration only fills gaps: every repository's own resources
  // and events are in place first, and none of them can be pre-empted by
  // another repository naming the same service as a consumer.
  composed = consumerFragments.reduce(mergeConsumerGraph, composed);

  const about = createDescribesRelationships(docs, composed.resources, {
    repository: options.repository,
  });

  composed = mergeArchitectureGraphs(composed, {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [],
    relationships: about.relationships,
  });

  failures.sort((a, b) =>
    `${a.repository}/${a.source}`.localeCompare(`${b.repository}/${b.source}`),
  );

  // Said out loud during the build as well as shown on the page: a quarantine
  // nobody is told about is the silent partial catalog this project exists to
  // refuse.
  const warnings = [
    ...about.failures.map((failure) => `${failure}, so it is missing from the graph`),
    ...failures.map((failure) =>
      failure.source === 'name'
        ? `${failure.repository} is missing from the graph — ${failure.message}`
        : `${failure.repository}: its ${failureSource(failure)} did not compile and is missing from the graph — ${failure.message}`,
    ),
    ...notes,
  ];

  // The commit each repository was read at, added after composition: every
  // Adapter emits the same minimal Repository fact, and only the site knows
  // which checkout it read.
  const commits = new Map(
    options.includeDates === false
      ? []
      : repositories.map(({ name, repositoryRoot }) => [name, headCommit(repositoryRoot)]),
  );

  // A model's page is its url, so the map and the Catalog link to it as they
  // do to a document.
  const models = catalogModels(composed, modelRepositories);
  const modelPages = new Map(models.map((model) => [resourceKey(model.resource.ref), model]));

  const graph: ResourceGraph = {
    ...composed,
    resources: composed.resources.map((resource) => {
      const commit = resource.ref.kind === 'repository' ? commits.get(resource.ref.id) : null;
      const model = modelPages.get(resourceKey(resource.ref));

      if (model) return { ...resource, url: modelPath(model) };

      return commit ? { ...resource, source: { repo: resource.ref.id, ref: commit } } : resource;
    }),
  };

  return {
    docs,
    events: events.sort((a, b) => a.event.frontmatter.id.localeCompare(b.event.frontmatter.id)),
    history,
    apis,
    models: models.map((model) => ({
      ...model,
      resource: { ...model.resource, url: modelPath(model) },
    })),
    manifest,
    kinds,
    graph,
    summary: summarizeResourceGraph(graph),
    failures,
    warnings,
  };
}

/**
 * A repository that commits no resources.json still gets its data models: the
 * passive model scan `ac resources scan` runs, which parses source without
 * running it, with owners from its CODEOWNERS. Only a scan that found a table
 * or collection is kept, so a repository without models adds nothing to the graph.
 */
async function scannedModels(
  repositoryRoot: string,
  repository: string,
  notes: string[],
): Promise<ResourceGraph | undefined> {
  const { graph, errors } = await modelScan(path.resolve(repositoryRoot));

  for (const error of errors) notes.push(`${repository}: data models were not scanned: ${error}`);

  return graph.resources.some(({ ref }) => ref.kind === 'table' || ref.kind === 'collection')
    ? graph
    : undefined;
}

type ModelScan = Promise<{ graph: ResourceGraph; errors: string[] }>;

declare global {
  // Configuring the site and rendering its pages each build the catalog, from
  // separately loaded copies of this module, so the scans are kept on the process.
  var autocatalogModelScans: Map<string, ModelScan> | undefined;
}

const modelScans = (globalThis.autocatalogModelScans ??= new Map());

/** One scan per repository checkout per process. */
function modelScan(root: string): ModelScan {
  const known = modelScans.get(root);

  if (known) return known;

  const scan = (async () => {
    const config = architectureConfig.parse(
      (await readOptionalResourceJson(path.join(root, '.autocatalog', 'config.json'), { root })) ??
        {},
    );

    const { graph, errors } = await scanModelResources({
      root,
      service: config.service,
      datastore: config.datastore,
      database: config.database,
    });

    const owned = resolveResourceOwnership(graph, {
      ...config.ownership,
      claims: [],
      codeowners: await loadCodeowners(root),
    });

    return { graph: owned.graph, errors };
  })();

  modelScans.set(root, scan);

  return scan;
}

/** What a quarantined repository failed to compile, as the file or folder its owners would open. */
export const failureSource = (failure: RepositoryFailure) =>
  failure.source === 'resources'
    ? RESOURCE_GRAPH_FILE
    : failure.source === 'consumers'
      ? CONSUMES_FILE
      : failure.source === 'apis'
        ? 'contracts/'
        : failure.source === 'name'
          ? 'repository name'
          : `${failure.source}/ catalog`;

/** An observation only adds evidence; a declaration or an owner says what the resource is. */
const declares = (entry: CatalogResource | CatalogRelationship) => {
  const provenance = 'ref' in entry ? entry.provenance.default : entry.provenance;

  return (
    ('owner' in entry && entry.owner !== undefined) ||
    (provenance !== 'observed' && provenance !== 'inferred')
  );
};

/** Everything but the evidence, with keys in one order, for comparing two definitions. */
const withoutEvidence = ({
  evidence: _evidence,
  ...entry
}: CatalogResource | CatalogRelationship) =>
  JSON.stringify(entry, (_key, value: JsonValue) =>
    isJsonObject(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );

function claim(
  declarations: Map<string, Set<string>>,
  repository: string,
  graph: ResourceGraph,
  options: { declaredOnly?: boolean } = {},
): void {
  const entries: Array<[string, CatalogResource | CatalogRelationship]> = [
    ...graph.resources.map((resource): [string, CatalogResource] => [
      resourceKey(resource.ref),
      resource,
    ]),
    ...graph.relationships.map((edge): [string, CatalogRelationship] => [
      relationshipKey(edge),
      edge,
    ]),
  ];

  for (const [key, entry] of entries) {
    if (options.declaredOnly && !declares(entry)) continue;
    declarations.set(key, (declarations.get(key) ?? new Set()).add(repository));
  }
}

/**
 * What one repository's resources.json may contribute to facts other
 * repositories declared: its runtime evidence, never a different definition
 * or owner. A contradicting declaration quarantines the fragment, as a
 * contradicting event does. The first declaration in sorted order stands.
 */
// The first repository to declare a datastore keeps it, as for events. An
// ownership registry could name which repository may declare which datastore.
function guardFragment(
  composed: ResourceGraph,
  fragment: { repository: string; graph: ResourceGraph },
  declarations: Map<string, Set<string>>,
): ResourceGraph {
  const resources = new Map(
    composed.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const relationships = new Map(
    composed.relationships.map((edge) => [relationshipKey(edge), edge]),
  );

  function guard<T extends CatalogResource | CatalogRelationship>(
    key: string,
    incoming: T,
    existing: T | undefined,
  ): T {
    const owners = declarations.get(key);

    if (!existing || !owners || owners.has(fragment.repository)) return incoming;

    if (declares(incoming) && withoutEvidence(incoming) !== withoutEvidence(existing))
      throw new Error(
        `${RESOURCE_GRAPH_FILE} redefines ${key}, which ${[...owners].sort().join(', ')} declares`,
      );

    return { ...existing, evidence: incoming.evidence };
  }

  return {
    ...fragment.graph,
    resources: fragment.graph.resources.map((resource) => {
      const key = resourceKey(resource.ref);

      return guard(key, resource, resources.get(key));
    }),
    relationships: fragment.graph.relationships.map((edge) => {
      const key = relationshipKey(edge);

      return guard(key, edge, relationships.get(key));
    }),
  };
}

/**
 * A document breaking the frontmatter contract fails the build, as `ac docs
 * check` fails the merge, and the build says which document and why: the
 * person reading it is fixing a file, not a count.
 */
function documentsManifest(root: string, options: BuildDocsCatalogOptions): DocsManifest {
  try {
    return buildDocsManifest(root, options);
  } catch (error) {
    if (!(error instanceof DocsManifestError)) throw error;
    throw new Error(`${error.message}:\n  ${error.failures.join('\n  ')}`, { cause: error });
  }
}

let cached: Promise<DocsCatalog> | undefined;

export function docsCatalog(): Promise<DocsCatalog> {
  if (!cached) {
    const { root, repo, repository, schemaPath, conventionsPath } = docsSiteConfig();
    cached = buildDocsCatalog(root, { repo, repository, schemaPath, conventionsPath });
  }

  return cached;
}

// Every document page asks this question, so the answer is grouped once per
// build rather than scanning the whole graph per render.
const definedByRepository = new WeakMap<DocsCatalog, Map<string, CatalogResource[]>>();

export function resourcesDefinedByRepository(
  catalog: DocsCatalog,
  repository: string,
): CatalogResource[] {
  let index = definedByRepository.get(catalog);

  if (!index) {
    const byKey = new Map(
      catalog.graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
    );

    index = new Map();

    for (const relationship of catalog.graph.relationships) {
      if (relationship.type !== 'defines' || relationship.from.kind !== 'repository') continue;
      const resource = byKey.get(resourceKey(relationship.to));

      if (!resource) continue;
      const bucket = index.get(relationship.from.id);

      if (bucket) bucket.push(resource);
      else index.set(relationship.from.id, [resource]);
    }

    definedByRepository.set(catalog, index);
  }

  return index.get(repository) ?? [];
}

export interface EventParticipants {
  producers: ShellLink[];
  consumers: ShellLink[];
}

/**
 * Who touches one event beyond what its own manifest names: Agents and Tools
 * that declare they produce or consume it, named `kind/id`, and services that
 * another repository declares consume it. None has a page of its own, so each
 * links to its entry in the Catalog, as a document about it does.
 */
export function eventParticipants(
  catalog: DocsCatalog,
  repository: string,
  event: LoadedEvent,
): EventParticipants {
  const namespace = `${repository}/${event.frontmatter.domain}`;
  const out: EventParticipants = { producers: [], consumers: [] };
  const listed = new Set(event.frontmatter.consumers);

  const link = (ref: ResourceRef): ShellLink => ({
    label: `${ref.kind}/${ref.id}`,
    kind: 'agent',
    href: catalogHref(ref),
  });

  const isThisEvent = (ref: { kind: string; namespace?: string; id: string }) =>
    ref.kind === 'event' && ref.namespace === namespace && ref.id === event.frontmatter.id;

  // Services produce and consume events too; those are already on the page.
  const isAgentSystem = (ref: { kind: string }) => ref.kind === 'agent' || ref.kind === 'tool';

  for (const { type, from, to } of catalog.graph.relationships) {
    // produces runs producer → event, consumes runs event → consumer.
    if (type === 'produces' && isThisEvent(to) && isAgentSystem(from)) {
      out.producers.push(link(from));
    } else if (type === 'consumes' && isThisEvent(from) && isAgentSystem(to)) {
      out.consumers.push(link(to));
    } else if (
      type === 'consumes' &&
      isThisEvent(from) &&
      to.kind === 'service' &&
      !listed.has(to.id)
    ) {
      out.consumers.push({ label: to.id, kind: 'service', href: catalogHref(to) });
    }
  }

  return out;
}

/**
 * An event's repository, domain, id and version, and each service it names,
 * become directories of the built site, so one that could climb out of its page
 * (`..`, a slash) or names nothing is refused, and the repository quarantined
 * with the reason.
 */
function assertRouteSegments(event: LoadedEvent): void {
  const { domain, id, version } = event.frontmatter;

  assertPathSegment(event.folder.path, 'domain', domain);
  assertPathSegment(event.folder.path, 'id', id);
  assertPathSegment(event.folder.path, 'version', version);
}
