# Autocatalog domain vocabulary

Defines the terms this project uses. Consistent language across docs, code, and reviews.

## Core concepts

**Event** — A message one service produces and others consume. Has an id, version, name, summary, domain, schema (JSON Schema), examples, and optional metadata (owner, producers, consumers, tags, badges, deprecation, source).

**JSON Schema interchange** — Every extractor (Zod, Pydantic, raw JSON Schema, AsyncAPI) emits JSON Schema as the payload contract. Language-specific validators are authoring DX; the catalog stores and diffs `schema.json` only.

**Event folder** — The on disk representation of an event. A directory under `events/<domain>/<EventName>/` containing `autocatalog.json` (canonical generated metadata), `schema.json`, `examples/`, and optionally `index.mdx` as a narrative override plus `versioned/`.

**IR (Internal Representation)** — The canonical Zod schema in `autocatalog-core` that validates event metadata. Mirrored in Python as a Pydantic model. Versioned as `autocatalog/v2`.

**Domain** — An organizational grouping. Defaults to the first directory segment under `events/`. Overridable in frontmatter. Used for grouping in the UI and filtering in search.

**Event manifest** — The generated `autocatalog.json` file in each event folder. Canonical structured metadata for the event. Validated against the IR schema. Contains id, version, name, summary, and optional owner, producers, consumers, consumerFields (the payload paths a consumer says it reads, `items[].sku`; a consumer without an entry has not said), tags, badges, status, classification (`internal | domain | integration | public`: who the event is for), deprecation, source, transport (the address, protocols and delivery mode the event travels on, from AsyncAPI or EventCatalog channels; context, not contract), schema path, example paths.

**Catalog snapshot** — A complete, validated in-memory view of one events root: loaded events plus structured diagnostics. Strict loading is the default. If any event cannot be loaded, the snapshot is rejected; consumers never receive a plausible-looking partial catalog.

**Catalog artifact** — The complete producer-owned output of one scan. It contains canonical event folders plus `autocatalog.artifact.json`, a deterministic index of Event paths and complete content hashes with repository revision and working-tree identity. Publication is staged, validated, locked, flushed, and transactionally swapped. Supported readers wait through the rename window and verify the index before returning a Catalog snapshot. Generated stale Events are removed; human-authored narrative is preserved or blocks retirement.

**Discovery Adapter** — An Implementation of the Scanner Interface. It receives a repository discovery context and emits cohesive Discovery Candidates. Installed adapter packages can advertise this Implementation in `package.json`, letting `ac scan` add a language or framework without changing the Scanner Module.

**Runtime discovery consent** — Explicit authorization to evaluate a trusted repository through runtime Discovery Adapters such as Zod. Without `--allow-code-execution`, the Scanner runs passive data Adapters only and refuses to silently execute installed code. Authorized Adapters run in a restricted child process; this provides least privilege and failure isolation, not a universal security sandbox.

**Discovery Candidate** — One indivisible discovery claim: an `AdapterEvent` and the finding/evidence that produced it. Candidates are resolved deterministically by provenance, confidence, and stable source ordering. A duplicate id emits an explicit conflict record.

**Runtime evidence** — A shared read model over saved event observations. Keeps declared consumers, snapshot participants and attribution strength separate; retains bounded trace references, producer/channel counts and field types, with unknown coverage. MCP investigation bundles hand these references to autotel-mcp after backend capability and scope checks; event pages render the same projection.

**Catalog projection** — The shared derived read model built from one Catalog snapshot. It owns current events, qualified event lookup, domains, services, architecture graph, and search records so Astro and MCP do not independently reinterpret the same catalog.

**Resource graph** — The canonical, typed read model compiled by resource Adapters. Every resource has a kind-qualified identity, source location, and field-level evidence; every relationship has a typed direction and its own evidence. Documents, Events, Agent-system entities, inferred Repositories, and inferred Services share the `autocatalog/graph-v1` contract exposed at `/catalog.json`. Deeper projections adapt from it rather than rebuilding catalog meaning. The contract is committed as JSON Schema at `packages/events/core/contracts/graph-v1.schema.json` and published with `autocatalog-core`, so an Adapter written in any language is held to the same rules as one written here — the same argument the frontmatter contract makes.

**Resource reference** — A collision-safe identity composed of a resource kind, optional namespace, id and optional version. References prevent an Event and a Service with the same human-readable id from colliding and are used as relationship endpoints.

**Datastore resource** — A Collection or Table with a logical datastore/database namespace, optionally carrying a model-derived JSON Schema. Service → datastore `reads` and `writes` relationships expose access and reader impact. Complete document observations can be validated; projections and patches cannot establish document validity.

**Command** — A versioned request contract with Service → Command `sends` and `handles` relationships, exactly one logical handler and an expected completion, result or event outcome. Queue resources describe transports without assuming message semantics.

**Architecture evidence** — Observations from OTLP spans attached to resources and relationships, including counts, times and sample trace ids. Observed relationships remain reviewable; promotion declares an edge while retaining its evidence. `.autocatalog/resources.json` stores the repository's graph independently of event declarations; it is written only when there are resources, and copied into the catalog artifact as `resources.json` for directory-mode drift. Re-importing one OTLP export counts its spans once. `.autocatalog/config.json` holds the scan identities (service, datastore, database, environment) every rescan applies. On the site, a repository's graph may add evidence to another repository's resources but never redefine or own them; a contradiction quarantines that repository's graph.

**Catalog relationship** — A typed, directed edge between Resource references, with provenance retained on the edge. Current types are `produces` (Service, Agent or Tool → Event), `consumes` (Event → Service, Agent or Tool), `publishes` (Repository → Document), `defines` (Repository → Event or Agent), `relatesTo` (Document → Document), `describes` (Document → any other Resource, declared in `about:`), `usesModel` (Agent → Model), `usesTool` (Agent → Tool), `governedBy` (Agent → Policy), `belongsTo` (Agent, Tool, or Workflow → Domain), `orchestrates` (Workflow → Agent), and `evaluates` (Eval → Agent).

**Agent system** — The operational graph around an AI Agent: Agents, Tools, Models, Workflows, Policies, Evals, and Domains. The Agents catalog remains the deep model for cost, audit, impact, and runtime drift; its resource Adapter projects shared identity and relationships into graph-v1.

**Catalog shell** — The central Starlight surface that discovers each enrolled repository's conventional `docs/`, `events/`, and Agent-system directories, composes their Adapter fragments, and publishes one browsable `/catalog` plus machine-readable `/catalog.json`. It does not flatten the deeper Events or Agents models; it navigates their shared Resource graph.

**Front door** — One CLI and one shell. `ac` is the only binary a user learns: `ac scan`, `ac site`, `ac docs check`, `ac agents audit`, and a bare directory (`ac .`, `npx autocatalog .`) means scan. The `autocatalog` package exists to be that name on npm and runs the same CLI. The Catalog shell is the one site, and `ac site` builds it; there is no second events or agents site to choose between. Internals stay modular — that is how Adapters compose — but the surface a company adopts is one command and one index.

**Quarantine** — A repository whose own catalog will not compile is left out of the composed graph, named on `/catalog` with the reason, and warned about during the build. The refusal to publish something partial is unchanged; it moves to where the mistake was made, because one team's broken catalog must not take down the index every other team reads.

**Document** — Markdown committed under a repository's conventional `docs/` root. Its path supplies its collision-safe identity; frontmatter supplies declared title, ownership, summary, tags, related-document edges, and the Resources it is `about`. A Document is a first-class Resource, not content attached to another Resource.

**Repository** — A structural Resource inferred from the filesystem layout or an Agent repository URL. Docs and Events use the conventional repository directory name; Agents use `repository.id` when declared and otherwise the URL basename. The explicit id is the override Seam when those conventions differ. All Adapters emit the same minimal Repository fact, allowing composition without fuzzy name matching. A Repository `publishes` Documents and `defines` Events or Agents.

**MDX** — Markdown with embedded components. `index.mdx` is optional and used for free form documentation or narrative override. It is not the canonical source of event metadata.

**Service** — An inferred entity with no on-disk representation. Built entirely from the `producers` and `consumers` fields on events. The `/services` page lists all services. `/services/:name` shows what each produces and consumes. Auto-generated. No MDX files. No manual definitions.

## Package architecture

**autocatalog-core** — The architectural keystone and deepest Module. Exports the IR, Discovery Adapter Interface, Scanner orchestration, atomic Catalog artifact publication, strict Catalog snapshots, shared Catalog projections, validation, drift, snippets, and LLM transforms. Loads canonical event metadata from generated manifests and treats MDX as optional narrative. No UI. Every other package depends on it; that leverage keeps catalog semantics local to one Module.

**autocatalog-docs-astro** — The one site. A Starlight plugin that reads every enrolled repository's `docs/`, `events/` and Agent-system directories and publishes document pages, event pages (`/events/<repository>/<domain>/<id>/`, namespaced so two repositories can publish the same id, with `schema.json` beside each), inferred service pages, `/fields`, `/catalog`, `/catalog.json`, Markdown twins and `llms.txt`. It also ships the ready-made site project `ac site` builds, configured entirely by environment variables, so nobody scaffolds a site.

**autocatalog-cli** — The `ac` binary. Discovers adapter plugins from `node_modules` (any package with `autocatalog-adapter-` prefix and an `autocatalog.adapter` field in `package.json`). Commands: validate, scan (built-in and installed Discovery Adapters), drift (catalog directory or Git-ref baseline), changelog, health, from-eventcatalog, from-asyncapi, init, import, dev, build, eject, plus dynamically registered adapter commands.

**autocatalog-adapter-zod** — Converts Zod schemas to JSON Schema `AdapterEvent`s. Provides `defineEvent()` for metadata in schema. Handles two input shapes: Compact (`{name, description, schema, example}`) and Explicit (`{id, version, name, summary, schema, ...}`). Writes via core `writeEventFolder`.

**autocatalog-mcp** — MCP server over stdio. Uses the strict catalog snapshot and projection from core. Twelve tools, including impact, compatibility and a runtime investigation handoff to autotel-mcp. Ships compiled stdio and server entry points.

**autocatalog-py** — Python Pydantic extractor. Discovers event models via decorator (`@autocatalog_event`), inner class (`Autocatalog`), `json_schema_extra` in `model_config`, or a marker export (`AUTOCATALOG_EVENTS = [...]`). Mirrors the TS IR as a Pydantic model. Calls `model.model_json_schema()` for schema generation.

**EventCatalog interop** — `ac to-eventcatalog` writes the catalog into an EventCatalog project through its MIT SDK, marking the domains it owns so a retired event or domain disappears on the next export while hand-written content stays, including the runtime evidence `autotel-eventcatalog stamp` writes between its `<!-- autotel:stamp-start/end -->` markers (generate with autocatalog, stamp and drift with autotel); the same code runs as an EventCatalog generator. `ac from-eventcatalog` reads one back, and the JSON Schema scanner reads `x-eventcatalog` metadata. EventCatalog draws the diagrams; autocatalog does not compete on them. `ac site --eventcatalog` builds EventCatalog 4 (`^4.10.7`, never the BUSL-licensed 5) under the site's `eventcatalog/` path and frames its visualiser on event and service pages and an Architecture page, using the ids and versions the export reports writing, so the diagrams live inside the one Catalog shell rather than in a second site. EventCatalog's chrome-free embed mode is its own licensed feature; without the key the frame shows its full visualiser.

## Key functions

**loadCatalogSnapshot(eventsRoot, opts?)**: Promise<CatalogSnapshot> — Discovers and loads the complete catalog with structured diagnostics. Strict by default; `mode: 'collect'` is reserved for validation/reporting flows.

**loadCatalog(eventsRoot, opts?)**: Promise<LoadedEvent[]> — Compatibility projection over a strict Catalog snapshot. It throws if any discovered event cannot load instead of silently omitting it.

**loadEventFolder(folder)**: Promise<LoadedEvent> — Requires `autocatalog.json` (throws without it — MDX frontmatter is never read), reads `schema.json`, discovers and loads examples, and treats the `index.mdx` body as optional narrative content. Exported from core.

**validateCatalog(eventsRoot)**: Promise<ValidationResult> — Combines discovery, loading, and validation. Checks frontmatter, JSON Schemas, examples, duplicates, references, spec versions, and version format, plus an optional project policy (`contracts/event-manifest.json`, a JSON Schema every manifest must also satisfy). Exported from core.

**pascalCase(input): string** — Splits on `.`, `-`, `_`, `/`, uppercases the first letter of each segment, joins. Used for generating folder names from event ids. Exported from core. Python has a matching `_pascal` in writer.

**defineEvent(meta, schema): T** — Wraps a Zod schema and attaches metadata via `Symbol.for("autocatalog:meta")`. Returns the schema unchanged. The adapter extracts metadata during conversion. Exported from adapter zod.

**mergeMetadata(explicit, schemaMeta): EventMetadata | undefined** — Merges explicit top level metadata fields with schema embedded metadata. Explicit wins. Returns undefined when neither side provides values.

**writeEventFolder({ outRoot, event })** — Writes `autocatalog.json` + `schema.json` + examples from an `AdapterEvent`. Exported from core; all extractors use it.

**publishCatalog({ outRoot, events, repository? })** — Writes a complete Catalog artifact to a staging directory, validates it, creates its hashed producer index, then atomically replaces the visible output. This is the normal write path for the Scanner; `writeEventFolder` is the lower-level Implementation detail.

**discoverJsonSchemas({ root, outDir? })** — Walks a repo for JSON Schema files (skips package/tsconfig noise), maps them to `AdapterEvent`s with provenance. Sidecar `*.autocatalog.json` or `x-autocatalog` supplies declared metadata.

**mergeDiscoveries(results)** — Resolves cohesive Discovery Candidates by event id. Higher provenance/confidence wins (declared > extracted > inferred); ties use stable source ordering and every collision is reported.

**toAdapterEvent(item): AdapterEvent** — Dispatch function for mapping Zod registry items to the internal AdapterEvent shape. Handles the Compact shape and the Explicit shape with a single call.

**createCatalogProjection(snapshot | events): CatalogProjection** — Derives graph, services, domains, search records, current events, and event lookup once. Exported from core and consumed by Astro and MCP.

**composeResourceGraphs(...fragments): ResourceGraph** — Deterministically composes graph fragments from multiple Adapters. Identical facts deduplicate, inferred Service observations merge their domains, and contradictory resources or relationships fail with `ResourceGraphConflictError` instead of silently replacing one another.

**createDocsResourceGraph(docs, manifest): ResourceGraph** — The Docs Adapter. Compiles validated Documents, inferred Repositories, `publishes` edges, and declared `relatesTo` edges into the shared graph contract.

**createAgentsResourceGraph(catalog): ResourceGraph** — The Agents Adapter. Rejects load or reference failures, then deterministically compiles all seven Agent-system kinds and their evidence-bearing relationships. Reference fields become graph edges; workflow conditions remain local attributes until relationship identity can represent qualifiers.

**buildGraph(events): GraphData** — Builds a node and edge graph from loaded events. Extracts services from `producers` and `consumers` fields. Produces nodes (events + services) and edges (produces/consumes). Exported from core.

**buildServices(events): Map<string, ServiceSummary>** — Builds a service summary map from loaded events. Groups all events by producer or consumer name. Each service entry lists which events it produces, consumes, and which domains it operates in. Exported from core.

**Scanner** — Repo-wide discovery (`ac scan`). Runs passive built-in Adapters plus explicitly authorized installed runtime Adapters in parallel, resolves candidates, enriches them, then publishes one complete Catalog artifact. Any Adapter error or protocol violation aborts publication. Emits IR v2 manifests with provenance, confidence, `needsReview`, and file/symbol/line source locations. Infers owners from CODEOWNERS and generates baseline examples when source supplies none — both labeled `inferred`.

**Provenance** — Where metadata came from: `declared` (a human wrote it), `extracted` (read from source), `inferred` (heuristics; may be wrong), or `overridden` (a client deliberately replaced the convention). Event-level default with per-field overrides. Convention-only scanner finds also get `needsReview: true`.

**Drift** — `ac drift --base <dir>` compares two generated Catalogs. `ac drift --base-ref origin/main --root .` checks out the ref, scans both source trees through the same Discovery Adapter Interface, and compares their immutable artifacts without requiring a committed baseline. Changes are breaking / suspicious / additive / info and name affected consumers. Where consumers declared the fields they read, a field change names those that read it, keeps those that never said (silence is not safety), and lists the rest as not affected. `ac changelog` renders version-to-version summaries.

**Importers** — `ac from-eventcatalog <dir>` migrates an EventCatalog markdown catalog (declared provenance, narrative preserved, producers/consumers inverted from service sends/receives). `ac from-asyncapi <file>` imports AsyncAPI 2.x/3.x documents.

**Health** — `ac health` scores each event 0–100 on summary, examples, owner, semver, producers/consumers, schema constraints, and review state, with hints and an optional `--min` gate.

**Demo seam** — `fixtures/demo-repo` is the single shared fixture: a fake service repo with deliberate warts (deprecated event, missing examples, convention-only export). Scanner goldens, drift stories, the EventCatalog export tests and MCP tests consume it, so fixtures cannot drift apart. `fixtures/event-starter` is a small published catalog for validation and MCP tests.

## Testing levels

Four levels, each owning one job: unit (Vitest, pure logic like diff/drift classification), integration (Vitest against fixtures/demo-repo with golden manifests), component (Astro Container API rendering the site's components), executable story (Playwright journeys against the built docs demo in examples/docs-demo).

Two rules keep the levels honest: a Playwright story proves the journey, never a render
state the component level already owns; and extraction correctness is proven by a level-2
golden manifest, never through an assertion on the rendered site.

## Data flow

```
Source code (Zod/Pydantic) or raw JSON Schema / OpenAPI / AsyncAPI
  → Discovery Adapter emits candidates (AdapterEvent + evidence)
    → Scanner resolves and enriches candidates
      → complete Catalog artifact published atomically
        → autocatalog-core loads one strict Catalog snapshot
          → shared Catalog projection (graph, services, search, lookup)
            → the Starlight site renders event, service and field pages
            → ac to-eventcatalog writes it into EventCatalog for diagrams
            → MCP server serves it to AI agents

Repository-owned Markdown
  → Docs convention discovers `<repo>/docs/**/*.md`
    → frontmatter contract validates every Document
      → Docs Adapter emits Documents, Repositories, and relationships
        → conventional sibling `<repo>/events` catalogs are loaded strictly
          → graph fragments compose through the shared Repository identity
            → Catalog shell, `/catalog`, `/catalog.json`, and document connections consume one projection

Agent manifests and framework source
  → conventions or discovery create the deep Agents Catalog
    → validation rejects broken Model, Tool, Policy, Domain, Workflow, and Eval references
      → Agents Adapter emits seven resource kinds and typed relationships
        → Catalog shell composes graph-v1 through filesystem Repository identity
        → audit, cost, impact, and drift retain the deep Agents model
```

## Spec version

`autocatalog/v2` — The current spec version. Validated in frontmatter. Future versions will be incrementally introduced. The spec string serves as a protocol identifier for forward compatibility.
