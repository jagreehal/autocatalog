import fs from 'node:fs';
import { parse } from 'devalue';
import { z } from 'zod';
import { type AccessDoc, readableCatalog } from './access';
import { withCodeowners } from './codeowned';
import { readerView } from './reader-view';
import { docPage } from './ui/lib/docs';
import path from 'node:path';
import {
  createAgentsResourceGraph,
  publishesAgentCatalog,
  loadCatalog as loadAgentsCatalog,
  type GraphEvent,
} from 'autocatalog-agents-core';
import {
  AUTOCATALOG_GRAPH_SPEC,
  assertPathSegment,
  buildServices,
  apiServiceProblem,
  createEndpointGraph,
  declaredApiService,
  createEventResourceGraph,
  createResourceGraphComposer,
  isEventCatalogResource,
  loadRepositoryEvents,
  findCatalogRoots,
  resourceKey,
  type LoadedEvent,
  summarizeResourceGraph,
  type CatalogResource,
  type RepositoryCalls,
  type ResourceGraph,
  type ResourceGraphSummary,
  type ResourceRef,
  readResourceGraph,
  mergeArchitectureGraphs,
  earlierVersions,
  architectureConflicts,
  relationshipKey,
  isJsonObject,
  COMPONENTS_FILE,
  CONSUMES_FILE,
  createConsumerResourceGraph,
  linkEndpointCalls,
  mergeConsumerGraph,
  withGateways,
  withNetworkPolicies,
  withoutCallerFields,
  withLinkedCalls,
  readConsumerDeclarations,
  readDeclarationsFile,
  createComponentResourceGraph,
  resolveReferences,
  parseResourceGraph,
  type RepositoryReferences,
  analyzeDelivery,
  deliveryEvents,
  scanDeliveryResources,
  type BehindReference,
  type ConsumerDeclaration,
  type DeliveryReport,
  RESOURCE_GRAPH_FILE,
  architectureConfig,
  loadCodeowners,
  readOptionalResourceJson,
  resolveResourceOwnership,
  scanCommandResources,
  scanModelResources,
  type CatalogRelationship,
  type JsonValue,
} from 'autocatalog-core';
import {
  buildDocsManifest,
  invalidDocuments,
  createDescribesRelationships,
  createDocsResourceGraph,
  DocsManifestError,
  headCommit,
  readDocs,
  resolveDocKinds,
  type BuildDocsManifestOptions,
  type Doc,
  type DocKind,
  type DocsManifest,
  type Design,
  type DomainModel,
  type Flow,
  readDesigns,
  glossaryGraph,
  readDomainModel,
  readOverviews,
  overviewTargets,
  type Overview,
  flowWorkflow,
  checkLifecycles,
  type FlowEvidence,
  type FlowNote,
  flowNotes,
  readFlowEvidence,
  readFlows,
  type WorkflowRuns,
} from 'autocatalog-docs-core';
import { apiPath, repositoryApis, servicesForApi, type CatalogApi } from './apis';
import { designsChangedAt } from './dev-signals';
import { repositorySpecifications, type CatalogSpecification } from './specifications';
import { publishedKinds, RESERVED_SEGMENTS } from './kinds';
import { catalogModels, modelPath, type CatalogModel } from './data-models';
import { termAnchor } from './model';
import { audienceReader, catalogForAudience } from './audience';
import { docsSiteConfig, type DocsSiteConfig } from './config';
import type { ShellLink } from './shell';
import { catalogHref } from './view';

/** A repository whose own catalog would not compile, and why. */
export interface RepositoryFailure {
  repository: string;
  /** Which convention failed to compile: the repository's events, agents or API specs, or its name. */
  source: 'docs' | 'events' | 'agents' | 'resources' | 'consumers' | 'components' | 'apis' | 'name';
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
  /** Every other specification each repository commits (WSDL, XML Schema, AsyncAPI…), each with a page. */
  specifications: CatalogSpecification[];
  /** The tables and collections each repository defines, each with a page. */
  models: CatalogModel[];
  /** The business processes each repository declares under flows/, each with a page. */
  flows: Flow[];
  /** Documents attached to a flow or one of its steps, whatever their kind. */
  flowNotes: FlowNote[];
  /** Each repository's committed comparison of its flows with code and runtime. */
  flowEvidence: Map<string, FlowEvidence>;
  /** The architecture each repository proposes under designs/, each with a page. */
  designs: Design[];
  /** Where each repository in the graph is on disk, by name: where `ac site` dev saves a design. */
  repositoryRoots: Record<string, string>;
  /** Each domain's glossary, and the entities, data products, teams and users repositories describe. */
  model: DomainModel;
  /** The text at the top of domain, service and system pages, from each repository's `overviews/`. */
  overviews: Overview[];
  manifest: DocsManifest;
  /** The document kinds with at least one document, each with an index page. */
  kinds: DocKind[];
  graph: ResourceGraph;
  summary: ResourceGraphSummary;
  /** Repositories quarantined from the graph, shown rather than swallowed. */
  failures: RepositoryFailure[];
  /** Services that declare they read an earlier release than the newest. */
  behind: BehindReference[];
  /** Repositories whose runtime snapshot was read, whatever it matched. */
  snapshots: string[];
  /** The workflow runs each repository's runtime snapshot recorded. */
  workflows: WorkflowRuns[];
  /**
   * Delivery routes across every repository: one team's broker configuration,
   * another's events and a third's consumer declarations make one route.
   */
  delivery: DeliveryReport;
  /**
   * What the build must say out loud: each quarantine, and each `about:` target
   * left out. Returned rather than printed, because one build compiles the
   * catalog more than once (configuration, then prerender), and a warning
   * repeated reads as two problems.
   */
  warnings: string[];
}

export type BuildDocsCatalogOptions = BuildDocsManifestOptions;

/**
 * Build the one graph the documentation site publishes. Filesystem layout is
 * the Adapter: every `docs/`, `events/` and `contracts/`, in sibling checkouts
 * or in a monorepo's packages, joins through the same inferred Repository
 * resource, without fuzzy name matching.
 */
export async function buildDocsCatalog(
  root: string,
  options: BuildDocsCatalogOptions = {},
): Promise<DocsCatalog> {
  // A repository with a document that breaks the contract has its documents
  // left out, and is named, rather than failing every team's build.
  const invalidDocs = invalidDocuments(root, options);
  const withoutInvalid = { ...options, exclude: [...invalidDocs.keys()] };
  const docs = readDocs(root, withoutInvalid);
  const manifest = documentsManifest(root, withoutInvalid);
  // Left out of a repository without quarantining it, such as an unreadable snapshot.
  const notes: string[] = [];

  const roots = findCatalogRoots(root, {
    name: options.repo,
    repository: options.repository,
    onWarning: (message) => notes.push(message),
  });

  // Only the root can carry an identity that is not its name.
  const identities = new Map(
    roots.flatMap(({ name, repository, duplicateOf }) =>
      duplicateOf === undefined ? [[name, repository] as const] : [],
    ),
  );

  const composer = createResourceGraphComposer();

  const docsGraph = createDocsResourceGraph(docs, manifest, { repositories: identities });
  composer.add(docsGraph);

  // Which repositories declared each resource and relationship, so one
  // repository's resources.json can add to another's facts but not rewrite them.
  const declarations = new Map<string, Set<string>>();
  claim(declarations, 'docs/', docsGraph);

  const failures: RepositoryFailure[] = [...invalidDocs].map(([repository, messages]) => ({
    repository,
    source: 'docs',
    message: messages.join('; '),
  }));

  const resourceFragments: Array<{
    repository: string;
    repositoryRoot: string;
    graph: ResourceGraph;
  }> = [];

  const events: CatalogEvent[] = [];
  const history: CatalogEvent[] = [];
  const apis: CatalogApi[] = [];
  const specifications: CatalogSpecification[] = [];

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

  // Repositories from outside the root, such as EventCatalog projects `ac site`
  // imported into its cache: each one repository, named by its folder.
  const { sources, indexes, serviceOwners } = docsSiteConfig();
  const taken = new Set(roots.map(({ repository }) => repository));

  const extra = sources.map((dir) => {
    const folder = path.basename(dir);
    // The command names these folders, not a team: one named like the site's
    // own pages publishes beside it rather than being left out.
    const name = RESERVED_SEGMENTS.has(folder) ? `${folder}-eventcatalog` : folder;

    if (name !== folder)
      notes.push(`${folder} publishes as ${name}: /${folder}/ is one of the site's own pages`);

    const duplicateOf = taken.has(name) ? '' : undefined;

    taken.add(name);

    return {
      name,
      repository: name,
      dir,
      path: dir,
      nested: [],
      ...(duplicateOf !== undefined && { duplicateOf }),
    };
  });

  // Sorted, so which of two contradicting repositories is quarantined does not
  // depend on the order the filesystem lists them in.
  const found = [...roots, ...extra]
    .map((catalogRoot) => ({
      ...catalogRoot,
      name: catalogRoot.repository,
      repositoryRoot: catalogRoot.dir,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

  // A repository's name is the first segment of its pages' addresses, so one
  // named like a page the site already has, or like another folder found
  // first, is left out until it is renamed.
  const repositories: typeof found = [];

  for (const candidate of found) {
    const { name, path: where, duplicateOf } = candidate;

    if (RESERVED_SEGMENTS.has(name))
      failures.push({
        repository: name,
        source: 'name',
        message: `/${name}/ is one of the site's own pages; rename the repository's folder to publish it`,
      });
    else if (duplicateOf !== undefined)
      failures.push({
        repository: name,
        source: 'name',
        message: `${where} and ${duplicateOf || 'the root'} both publish as ${name}; rename one folder to publish both`,
      });
    else repositories.push(candidate);
  }

  const kinds = publishedKinds(
    resolveDocKinds(root, options.conventionsPath).kinds,
    manifest,
    new Set([...docs.map((doc) => doc.repo), ...repositories.map(({ name }) => name)]),
  );

  // Every repository's events first, so an agent in one repository can name an
  // event another publishes and the edge lands on that exact Event resource.
  const graphEvents: GraphEvent[] = [];
  // Earlier versions, for a reference whose range picks one.
  const earlier: ResourceGraph[] = [];
  const snapshots: string[] = [];
  const workflows: WorkflowRuns[] = [];
  const brokerGraphs: ResourceGraph[] = [];
  const deliveryConsumers: ConsumerDeclaration[] = [];

  for (const { name, repositoryRoot, nested } of repositories) {
    let resourceGraph: ResourceGraph | undefined;

    try {
      resourceGraph =
        (await readResourceGraph(repositoryRoot)) ??
        (await scannedModels(repositoryRoot, name, notes, root, nested));

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
        ownersWithin: root,
        exclude: nested,
        history: true,
        onWarning: (message) => notes.push(`${name}: ${message}`),
        onSnapshot: () => snapshots.push(name),
        onWorkflows: (runs) =>
          workflows.push(...runs.map((workflow) => ({ repository: name, workflow }))),
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

    earlier.push(earlierVersions(loaded, name));

    if (resourceGraph) brokerGraphs.push(resourceGraph);

    // A malformed consumes file is reported where consumers are joined, below.
    deliveryConsumers.push(...(await readConsumerDeclarations(repositoryRoot).catch(() => [])));

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
        specifications.push(
          ...repositorySpecifications(name, repositoryRoot, (message) => notes.push(message)),
        );
      } catch (error) {
        failures.push({
          repository: name,
          source: 'apis',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await quarantine(
      name,
      'components',
      async () =>
        (await createComponentResourceGraph(name, repositoryRoot, { ownersWithin: root })) ?? {
          spec: AUTOCATALOG_GRAPH_SPEC,
          resources: [],
          relationships: [],
        },
    );

    if (publishesAgentCatalog(repositoryRoot)) {
      await quarantine(name, 'agents', async () =>
        createAgentsResourceGraph(await loadAgentsCatalog(repositoryRoot), {
          repository: name,
          urls: false,
          events: graphEvents,
        }),
      );
    }
  }

  // A sidecar naming a service no event mentions links to nothing; said, not linked.
  const services = new Set(buildServices(events.map(({ event }) => event)).keys());

  for (const spec of specifications) {
    for (const service of spec.services.filter((name) => !services.has(name))) {
      notes.push(
        `${spec.repository}: ${spec.file} names service ${service}, which no event produces or consumes`,
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
          onWarning: (message) => notes.push(`${name}: ${message}`),
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

  for (const api of apis) {
    const failed = (message: string) =>
      failures.push({
        repository: api.repository,
        source: 'apis',
        message: `${api.file}: ${message}`,
      });

    try {
      const problem = apiServiceProblem(api.document);

      if (problem) failed(problem);

      const declared = declaredApiService(api.document);

      // With a lock, a spec serves only a service the lock pins to its repository.
      const unpinned = Boolean(
        declared && serviceOwners && serviceOwners.get(declared) !== api.repository,
      );

      if (unpinned)
        failed(
          `x-autocatalog.service names ${declared}, which the lock does not pin to ${api.repository}, so no service exposes its operations`,
        );

      // A service guessed from the title or webhooks is held to the lock the same way.
      const services = unpinned
        ? []
        : servicesForApi(api, events).filter(
            (service) => !serviceOwners || serviceOwners.get(service) === api.repository,
          );

      // A service a spec names gets a page, so its name is a path too.
      for (const service of services) assertPathSegment(api.file, 'service', service);

      // Pages show what the graph holds, the lock applied.
      api.services = services;

      composed = mergeConsumerGraph(
        composed,
        createEndpointGraph({ ...api, services, url: apiPath(api) }, failed),
      );
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  }

  // Last, so a declaration only fills gaps: every repository's own resources
  // and events are in place first, and none of them can be pre-empted by
  // another repository naming the same service as a consumer.
  composed = consumerFragments.reduce(mergeConsumerGraph, composed);

  // Other sites' graphs, joined without pages: their resources and edges fill
  // in what this site does not have, and never replace what it does. Joined
  // first, so a reference here can resolve to something only they publish.
  for (const file of indexes) {
    try {
      const joined = parseResourceGraph(JSON.parse(fs.readFileSync(file, 'utf8')));
      const have = new Set(composed.relationships.map(relationshipKey));

      // Only what this site lacks: an edge it already has keeps its own attributes.
      composed = mergeConsumerGraph(composed, {
        ...joined,
        relationships: joined.relationships.filter((edge) => !have.has(relationshipKey(edge))),
      });
    } catch (error) {
      notes.push(
        `${path.basename(file)}: not joined (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  // References by id to what another repository owns (EventCatalog's `sends`
  // and `receives`), resolved once against everything composed, the indexes
  // included. One that names nothing, or more than one thing, is said and left out.
  const references: RepositoryReferences[] = [];
  const calls: RepositoryCalls[] = [];

  for (const { name, repositoryRoot } of repositories) {
    if (quarantined.has(name)) continue;

    const declared = await readDeclarationsFile(repositoryRoot).catch(() => undefined);

    if (declared && declared.receives.length + declared.sends.length > 0)
      references.push({ repository: name, receives: declared.receives, sends: declared.sends });

    if (declared?.calls.length) calls.push({ repository: name, calls: declared.calls });
  }

  const resolved = resolveReferences(composed, references, mergeArchitectureGraphs(...earlier));

  notes.push(...resolved.unresolved);
  composed = mergeConsumerGraph(composed, resolved.graph);

  // Fields on a call to an endpoint count only from a declaration its owner made.
  composed = withoutCallerFields(composed);

  const called = linkEndpointCalls(composed, calls, { owners: serviceOwners });

  notes.push(...called.unresolved, ...called.unverified);
  composed = withLinkedCalls(composed, called.graph);

  const composedRepositories = repositories.flatMap(({ name, repositoryRoot }) =>
    quarantined.has(name) ? [] : [{ repository: name, dir: repositoryRoot }],
  );

  // Gateways last: they expose endpoints, which must all be in place.
  composed = await withGateways(composed, composedRepositories, (message) => notes.push(message));

  // Calls and gateway exposure, checked against who the network lets reach whom.
  await withNetworkPolicies(composed, composedRepositories, (message) => notes.push(message));

  // Owners from each repository's CODEOWNERS, for everything composed from it.
  composed = await withCodeowners(
    composed,
    composedRepositories.map(({ repository, dir }) => ({ name: repository, root: dir })),
    apis,
    root,
  );

  const about = createDescribesRelationships(docs, composed.resources, {
    repositories: identities,
  });

  composed = mergeArchitectureGraphs(composed, {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [],
    relationships: about.relationships,
  });

  const enrolled = repositories
    .filter(({ name }) => !quarantined.has(name))
    .map(({ name, repositoryRoot }) => ({ repository: name, dir: repositoryRoot }));

  // Read against the whole composed catalog, so a flow or design can cross repositories.
  const flows = readFlows(enrolled, composed);

  const designs = readDesigns(enrolled, composed);

  const schemas = new Map(
    events.map(({ repository, event }) => [
      `${repository}/${event.frontmatter.domain}/${event.frontmatter.id}`,
      event.schema,
    ]),
  );

  const {
    failures: modelFailures,
    warnings: modelWarnings,
    ...model
  } = readDomainModel(enrolled, composed, {
    schemaOf: (event) => schemas.get(`${event.ref.namespace}/${event.ref.id}`),
  });

  // Domain, service and system overviews, matched against the composed
  // catalog: what no repository declares is left out with a warning.
  const overviewsRead = readOverviews(
    enrolled,
    overviewTargets(composed.resources, {
      service: events.flatMap(({ event }) => [
        ...event.frontmatter.producers,
        ...event.frontmatter.consumers,
      ]),
      system: designs.designs.flatMap((design) =>
        design.resources.flatMap((resource) =>
          resource.type === 'system' || resource.type === 'external-system' ? [resource.id] : [],
        ),
      ),
    }),
  );

  // The words teams use, joined to what implements them: how an agent gets from
  // "customer onboarding" to the services and events behind it.
  composed = mergeArchitectureGraphs(
    composed,
    glossaryGraph(model.glossaries, (domain, term) => `/glossary/#${termAnchor(domain, term)}`),
  );

  const lifecycleCheck = checkLifecycles(flows.flows, model.entities);
  const notesOnFlows = flowNotes(docs, flows.flows);

  failures.sort((a, b) =>
    `${a.repository}/${a.source}`.localeCompare(`${b.repository}/${b.source}`),
  );

  // Said out loud during the build as well as shown on the page: a quarantine
  // nobody is told about is the silent partial catalog this project exists to
  // refuse.
  const warnings = [
    ...about.failures.map((failure) => `${failure}, so it is missing from the graph`),
    ...flows.failures.map((failure) => `${failure}, so it is left out`),
    ...designs.failures.map((failure) => `${failure}, so it is left out`),
    ...modelFailures.map((failure) => `${failure}, so it is left out`),
    ...overviewsRead.failures.map((failure) => `${failure}, so it is left out`),
    ...overviewsRead.warnings,
    ...flows.warnings,
    ...flows.flows.flatMap((flow) => {
      const { ambiguous } = flowWorkflow(flow, workflows);

      return ambiguous.length > 1
        ? [
            `${flow.repository}/${flow.file}: ${ambiguous.join(' and ')} each record a workflow it could be, so its runs are not shown; name one with workflow:`,
          ]
        : [];
    }),
    ...modelWarnings,
    ...lifecycleCheck.failures,
    ...lifecycleCheck.warnings,
    ...notesOnFlows.warnings,
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
    specifications,
    flows: flows.flows,
    flowNotes: notesOnFlows.notes,
    flowEvidence: new Map(
      enrolled.flatMap(({ repository, dir }) => {
        const evidence = readFlowEvidence(dir);

        return evidence ? [[repository, evidence] as const] : [];
      }),
    ),
    designs: designs.designs,
    repositoryRoots: Object.fromEntries(enrolled.map(({ repository, dir }) => [repository, dir])),
    model,
    overviews: overviewsRead.overviews,
    models: models.map((model) => ({
      ...model,
      resource: { ...model.resource, url: modelPath(model) },
    })),
    manifest,
    kinds,
    graph,
    summary: summarizeResourceGraph(graph),
    failures,
    behind: resolved.behind,
    snapshots,
    workflows,
    delivery: analyzeDelivery({
      graph: mergeArchitectureGraphs(...brokerGraphs),
      events: deliveryEvents(events.map(({ event }) => event)),
      consumers: deliveryConsumers,
    }),
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
  ownersWithin: string,
  nested: string[],
): Promise<ResourceGraph | undefined> {
  const { graph, errors } = await modelScan(path.resolve(repositoryRoot), ownersWithin, nested);

  for (const error of errors) notes.push(`${repository}: ${error}`);

  return graph.resources.some(
    ({ ref }) =>
      ['table', 'collection', 'command'].includes(ref.kind) ||
      // A broker's exchanges, topics, queues and subscriptions, from its configuration.
      ref.kind === 'queue',
  )
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
function modelScan(root: string, ownersWithin: string, nested: string[]): ModelScan {
  const key = JSON.stringify([root, nested]);
  const known = modelScans.get(key);

  if (known) return known;

  const scan = (async () => {
    const config = architectureConfig.parse(
      (await readOptionalResourceJson(path.join(root, '.autocatalog', 'config.json'), { root })) ??
        {},
    );

    const { graph, errors } = await scanModelResources({
      root,
      // Packages below publish their own models.
      exclude: nested,
      service: config.service,
      datastore: config.datastore,
      database: config.database,
    });

    const commands = await scanCommandResources({ root, exclude: nested });

    const delivery = await scanDeliveryResources({
      root,
      exclude: nested,
      environment: config.environment,
    });

    const owned = resolveResourceOwnership(
      mergeArchitectureGraphs(graph, commands.graph, delivery.graph),
      {
        ...config.ownership,
        claims: [],
        codeowners: await loadCodeowners(root, ownersWithin),
      },
    );

    return {
      graph: owned.graph,
      errors: [
        ...errors.map((error) => `data models were not scanned: ${error}`),
        ...commands.errors.map((error) => `commands were not scanned: ${error}`),
        ...delivery.errors.map((error) => `broker configuration was not scanned: ${error}`),
      ],
    };
  })();

  modelScans.set(key, scan);

  return scan;
}

/** What a quarantined repository failed to compile, as the file or folder its owners would open. */
export const failureSource = (failure: RepositoryFailure) =>
  failure.source === 'resources'
    ? RESOURCE_GRAPH_FILE
    : failure.source === 'components'
      ? COMPONENTS_FILE
      : failure.source === 'consumers'
        ? CONSUMES_FILE
        : failure.source === 'apis'
          ? 'contracts/'
          : failure.source === 'name'
            ? 'repository name'
            : failure.source === 'docs'
              ? 'docs/'
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

/**
 * The catalog a site publishes: everything, or for a site with an audience,
 * only what that audience may read.
 */
export async function buildSiteCatalog(
  site: DocsSiteConfig,
  options: BuildDocsCatalogOptions = {},
): Promise<DocsCatalog> {
  const { root, repo, repository, schemaPath, conventionsPath, audience } = site;

  const catalog = await buildDocsCatalog(root, {
    repo,
    repository,
    schemaPath,
    conventionsPath,
    ...audienceReader(audience),
    ...options,
  });

  const published = withPageUrls(catalog);

  return audience ? catalogForAudience(published) : published;
}

/**
 * Each document in the graph linked where its page is: without the repository's
 * name on a site that publishes it at the root (`atRoot`).
 */
function withPageUrls(catalog: DocsCatalog): DocsCatalog {
  if (!process.env.AUTOCATALOG_DOCS_ROOT_REPO) return catalog;

  const resources = catalog.graph.resources.map((resource) =>
    resource.ref.kind === 'document' && resource.url
      ? {
          ...resource,
          url: `/${docPage(`${resource.ref.namespace}/${resource.ref.id}`)
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
        }
      : resource,
  );

  return { ...catalog, graph: { ...catalog.graph, resources } };
}

let cached: Promise<DocsCatalog> | undefined;

let cachedAt = 0;

/**
 * The catalog the pages are built from, as the reader a page renders for may
 * see it on a site with `access`: their documents only. Outside a request, such
 * as in `getStaticPaths`, it is what a signed-out reader may open.
 */
export async function docsCatalog(): Promise<DocsCatalog> {
  const catalog = await fullCatalog();
  const view = readerView.getStore() ?? openToEveryone();

  return view ? readableCatalog(catalog, view) : catalog;
}

/**
 * The guides a signed-out reader may open, from the build that tried the
 * access rule. A site with `access` whose build could not try it has none.
 */
function openToEveryone(): ((doc: AccessDoc) => boolean) | undefined {
  if (!process.env.AUTOCATALOG_SITE_ACCESS) return undefined;

  const open = new Set(
    z
      .array(z.string())
      .catch([])
      .parse(JSON.parse(process.env.AUTOCATALOG_DOCS_OPEN ?? '[]')),
  );

  return (doc) => open.has(doc.id);
}

/** Every document, whoever is reading: for the access rule itself. */
export function fullCatalog(): Promise<DocsCatalog> {
  // A server build carries the catalog it was built from, so a deployment
  // answers without the repositories beside it. See `catalogSnapshot`.
  const snapshot = import.meta.env.AUTOCATALOG_CATALOG;

  if (snapshot) {
    cached ??= Promise.resolve<DocsCatalog>(parse(snapshot));

    return cached;
  }

  // `ac site` dev: a design changed on disk since this catalog was read.
  if (designsChangedAt() > cachedAt) cached = undefined;

  if (!cached) {
    cachedAt = Date.now();

    const building = buildSiteCatalog(docsSiteConfig());

    cached = building;

    // A build that fails is not kept, so the next request tries again. Callers
    // still get the rejection from `building` itself.
    building.catch(() => {
      if (cached === building) cached = undefined;
    });
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
