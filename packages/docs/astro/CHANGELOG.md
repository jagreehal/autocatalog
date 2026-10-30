# autocatalog-docs-astro

## 0.7.0

### Minor Changes

- 1ff9943: - Edit a design on EventCatalog Studio's canvas under `ac site` dev. The panel beside it shows what the design adds, who owns each catalog resource it touches, and what a runtime snapshot saw on each relation. New parts carry a dashed outline. ⌘S writes `designs/<id>.md`, one line per resource and relation, ready to commit.
  - Start a design from `/designs`. When an agent, an editor or another tab writes the file, the open canvas loads it in place and asks first if you have unsaved changes.
  - Designs take `hotspots:`, listed first on the design page.
  - Click a node on a map to see its card, with a button to its page.
  - The Versions card on an event shows each version's changes as a timeline.
  - MCP tools return compact JSON.

### Patch Changes

- Updated dependencies [1ff9943]
  - autocatalog-docs-core@0.5.0

## 0.6.0

### Minor Changes

- bb5e41e: - Keep your domain model beside your docs in EventCatalog's field names: `glossary/`, `entities/`, `data-products/`, `teams/` and `users/`. Each gets a page, a repository with only these folders joins the site, and `ac docs check` checks every file.
  - Write docs in `.mdx` with `<Map>`, `<Schema>`, `<Term>` and `<Owner>`, and add your own pages and API routes with `ac site --pages <dir>`. The MCP `define` tool explains a domain word.
  - Commands name the queue their handler replies on with `outcome.replyTo`, and `ac to-asyncapi --commands <dir>` writes them with an AsyncAPI `reply`. `ac drift` tells events and commands apart.
  - Flow steps name their compensation with `compensated_by`, and the flow page shows each saga run step by step.
  - Consumers declare a dead-letter queue in `autocatalog.consumes.json`. Event pages show what each consumer did with its deliveries, and `ac drift --snapshot` reports dead-lettered deliveries and events with two producers.

### Patch Changes

- Updated dependencies [bb5e41e]
  - autocatalog-core@0.5.0
  - autocatalog-docs-core@0.4.0
  - autocatalog-agents-core@0.2.4

## 0.5.0

### Minor Changes

- 3968aaa: - `designs/<id>.md` proposes architecture you have not built yet, in the
  vocabulary of EventCatalog Studio's model. Each design gets a page that marks
  what the catalog has and what is new, with three levels of detail.
  `ac docs check` checks designs as it checks flows.
  - `show_map` draws the catalog, a flow or a design as an interactive diagram in
    Claude, ChatGPT and other MCP App hosts, with runtime evidence on each edge.
    It follows the host's theme and size, opens full screen on request, and tells
    the agent which node you picked. An agent can sketch a design in the chat and
    hand you the file to commit.
  - A flow's `lanes:` sets how its map opens, and a step's `lane:` sets which lane
    it sits in. Flows can also group by system.
- 96719f9: `autocatalog site`, `ac docs check` and the EventCatalog export find repositories anywhere under the root. Each package in a monorepo publishes its docs, contracts and consumer declarations under its folder name, with owners from the monorepo's CODEOWNERS.

  Repositories can declare business processes in `flows/<id>.md`. Each flow gets a page with a step-by-step walkthrough, and you can group its steps by domain or team, as boxes or lanes. Steps can name events, services and agents from any repository, and the site flags any hop that no producer or consumer declaration backs.

  The site publishes WSDL, XML Schema, XML, GraphQL, RAML and AsyncAPI files from `contracts/`, each on its own page with a download. A `<name>.autocatalog.json` sidecar attaches a specification to a service or publishes any JSON or YAML file.

  Maps use `@eventcatalog/visualiser` 5.1.2.

### Patch Changes

- Updated dependencies [3968aaa]
- Updated dependencies [96719f9]
  - autocatalog-docs-core@0.3.0
  - autocatalog-core@0.4.0
  - autocatalog-agents-core@0.2.3

## 0.4.0

### Minor Changes

- 5cd0cb5: Retirements, meaning checks, catalog rules and runtime evidence.

  - `ac retire <event> [field]` says whether a field or event can go yet, consumer by consumer, from declarations, snapshots and pacts. The site's Retirements page tracks each deprecated event and field.
  - `x-meaning` declares a field's unit, currency or timezone, and `ac drift` fails a change to it.
  - Catalog rules in `contracts/rules/` run from the base branch with `ac drift --base-ref --allow-code-execution` and gate on the violations a change adds.
  - `ac drift --snapshot` checks payload types and enums, and names undeclared producers and channels.
  - `ac from-snapshot` drafts contracts from an autotel snapshot.
  - Site maps show what ran on each edge, with Replay and Live modes (`ac site --live-url`).
  - Document kinds for ADRs, runbooks and incidents, and pages for Prisma, Drizzle and Mongoose models.
  - A living map home page, JetBrains Mono and a blueprint palette.

- 59855f0: `autocatalog site` adds domain pages with maps, API reference pages for OpenAPI specs under `contracts/`, and a schema index. Service maps show the services on the other side of each event, and the catalog map includes commands, queries and datastores. Mermaid fences render as diagrams, events show their badges and draft status, event and service pages get Markdown twins, and `llms-full.txt` holds the full text for agents.

### Patch Changes

- Updated dependencies [5cd0cb5]
- Updated dependencies [59855f0]
  - autocatalog-docs-core@0.2.0
  - autocatalog-core@0.3.0
  - autocatalog-agents-core@0.2.2

## 0.3.0

### Minor Changes

- 6eab2f9: `autocatalog site` serves `contracts/docs-manifest.json`, so `ac docs check --manifest` reads links from the same site that renders the docs. The home page lists tags in one table, evidence from contract files reads "Extracted from source", and schema enum values wrap between values.

### Patch Changes

- Updated dependencies [acf1994]
  - autocatalog-docs-core@0.1.2

## 0.2.1

### Patch Changes

- 1b03b64: `autocatalog site` builds inside any project layout. It renders with its own React when the project installs another React at the top of a flat `node_modules`, such as an EventCatalog project, and it brings the js-yaml its bundled Starlight code imports.

## 0.2.0

### Minor Changes

- 98b459d: Teams can declare the events they consume from their own repository, so a producer's pull request names consumers in every repository.

  - `autocatalog.consumes.json` lists a service, another team's event as `domain/id`, and the fields it reads.
  - `ac site` publishes every repository's declarations in `/catalog.json` and lists them on each event's page.
  - `ac drift --consumers <url|file>` reads that index and names the consumers each change reaches, by the fields they read. It prints when the index was published, and counts the consumers of every copy of an event two repositories publish unless `--repository` names its own.
  - `ac validate --catalog <url|file>` checks each declared field against the schema the producer publishes.
  - `ac drift --snapshot` names the consumers a runtime snapshot recorded.

  The Zod adapter's name-encoded export shape is now the compact shape: `parseCompactName`, `CompactItem` and `isCompactItem`.

### Patch Changes

- Updated dependencies [98b459d]
  - autocatalog-core@0.2.0
  - autocatalog-agents-core@0.2.1
  - autocatalog-docs-core@0.1.1

## 0.1.0

### Minor Changes

- 8ffcbf6: First public release.

  autocatalog reads the event contracts your repositories already hold (Zod, Pydantic, JSON Schema, OpenAPI, AsyncAPI, Avro, protobuf) and writes them into a catalog you commit beside the code. Each field records whether you declared it, the scanner extracted it, or the scanner inferred it.

  - `autocatalog` and `autocatalog-cli` give you the `ac` command. `ac scan` builds the catalog, `ac validate` and `ac health` check it, and `ac drift --base-ref origin/main` fails a pull request that breaks a consumer, a delivery promise or another team's datastore.
  - `autocatalog-core` holds the catalog model, the loaders, the resource graph and the drift rules. It validates each schema in the JSON Schema dialect the schema declares. A scan on Windows records the same forward-slash paths as one on macOS or Linux, so CODEOWNERS matches and the committed catalog doesn't change between machines.
  - `autocatalog-adapter-zod` turns Zod schemas into catalog events with `defineEvent`.
  - `autocatalog-mcp` lets AI agents query the catalog over MCP.
  - `autocatalog-docs-core` and `autocatalog-docs-astro` build one Starlight site across every repository you enrol, with pages for events, services, owners and fields.
  - `autocatalog-agents-core`, `autocatalog-agents-cli`, `autocatalog-agents-mcp` and `autocatalog-agents-adapter-autotel` catalog AI agents, their tools, models and policies, and check them against autotel traces.

  If your team runs EventCatalog, you keep it. `ac from-eventcatalog` imports your events, commands, queries, services, datastores, owners and systems. `ac to-eventcatalog` writes them back through EventCatalog's MIT SDK, and a second import gives back the same files. Your portal stays in EventCatalog while `ac drift` gates the pull requests. `ac site --eventcatalog` can also frame EventCatalog's diagrams inside the autocatalog site.

### Patch Changes

- Updated dependencies [8ffcbf6]
  - autocatalog-core@0.1.0
  - autocatalog-docs-core@0.1.0
  - autocatalog-agents-core@0.2.0
