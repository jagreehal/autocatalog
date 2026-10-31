# autocatalog-cli

## 0.6.2

### Patch Changes

- 80cb2b2: - `task_context` gives an agent what to read before a task: the services, contracts, decision records, runbooks and owners its words name, how each relationship is known, and what the catalog could not establish. `--site` reads the company site's `/catalog.json` so the bundle covers every repository.
  - A breaking drift finding shows a payload the new schema accepts and the current contract rejects, with the check it fails.
  - Glossary terms take `aliases` and `about`, so a business word leads to the services and events that implement it.
  - New `/channels` and `/systems` pages, `[[kind|id]]` links in prose, pinned pages in the sidebar, a resizable sidebar, status banners, field lineage on schema trees, `?embed=1`, and a home page that counts what needs attention.
- Updated dependencies [80cb2b2]
  - autocatalog-core@0.6.0
  - autocatalog-docs-core@0.6.0
  - autocatalog-docs-astro@0.8.0
  - autocatalog-agents-core@0.2.5
  - autocatalog-adapter-zod@0.2.4

## 0.6.1

### Patch Changes

- Updated dependencies [1ff9943]
  - autocatalog-docs-core@0.5.0
  - autocatalog-docs-astro@0.7.0

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
  - autocatalog-docs-astro@0.6.0
  - autocatalog-agents-core@0.2.4
  - autocatalog-adapter-zod@0.2.3

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
  - autocatalog-docs-astro@0.5.0
  - autocatalog-core@0.4.0
  - autocatalog-agents-core@0.2.3
  - autocatalog-adapter-zod@0.2.2

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

### Patch Changes

- Updated dependencies [5cd0cb5]
- Updated dependencies [59855f0]
  - autocatalog-docs-core@0.2.0
  - autocatalog-docs-astro@0.4.0
  - autocatalog-core@0.3.0
  - autocatalog-agents-core@0.2.2
  - autocatalog-adapter-zod@0.2.1

## 0.3.1

### Patch Changes

- acf1994: `ac --version` prints the installed version. `ac site` reports how many repositories it cloned and whether it had a token. Source and edit links point at the repository's default branch. `ac docs manifest` suggests publishing the file where `ac docs check --manifest` can fetch it.
- Updated dependencies [acf1994]
- Updated dependencies [6eab2f9]
  - autocatalog-docs-core@0.1.2
  - autocatalog-docs-astro@0.3.0

## 0.3.0

### Minor Changes

- e58430a: The EventCatalog generator scans repositories. `['autocatalog-cli/eventcatalog', { repositories: ['../payments-service'] }]` reads each one like `ac scan`, runs its installed adapters once you set `allowCodeExecution: true`, and sets the exit code your CI checks. Scoped adapters such as `@acme/autocatalog-adapter-orders` load like any other, and a new guide shows how to write one. `ac site` clones each repository once, builds from every repository it reaches, names the rest, and swaps in the new site when the build completes.

## 0.2.1

### Patch Changes

- 1b03b64: `autocatalog site` builds inside any project layout. It renders with its own React when the project installs another React at the top of a flat `node_modules`, such as an EventCatalog project, and it brings the js-yaml its bundled Starlight code imports.
- Updated dependencies [1b03b64]
  - autocatalog-docs-astro@0.2.1

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
  - autocatalog-docs-astro@0.2.0
  - autocatalog-adapter-zod@0.2.0
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
  - autocatalog-adapter-zod@0.1.0
  - autocatalog-docs-core@0.1.0
  - autocatalog-docs-astro@0.1.0
  - autocatalog-agents-core@0.2.0
