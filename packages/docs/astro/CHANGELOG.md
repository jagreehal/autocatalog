# autocatalog-docs-astro

## 0.13.0

### Minor Changes

- ab0b648: Build branded public sites, help centres and an assistant from `autocatalog.site.json`.

  - `extend` adds your middleware, component overrides, CSS, head tags, Markdown plugins, Starlight plugins and Astro integrations. `pages` adds your own pages and API routes, and a page at a built-in address replaces that page. `"output": "server"` renders pages per request and writes `server.mjs`, carrying the catalog it was built from so `dist/` deploys on its own.
  - White-label without code: `social`, `head` and `strings` (the interface's words), `nav` for sections in the header and phone menu, a `favicon.ico` or `favicon.png`, and `brand/public/` served as it is, with the fonts and images `theme.css` uses bundled.
  - `"audience": "public"` publishes the guides that name that audience and each OpenAPI reference with Scalar, leaving out `x-internal` paths, operations, webhooks and callbacks, with the tags and components only they use. Owners, events, services and the graph stay on the internal site, and `llms.txt` links each API's `openapi.json`.
  - `access` names a module that says who is reading. A guide opens when the reader holds everything its `access:` lists, set per guide or per folder in `docs/meta.json`, or as your `canRead` decides. Pages, the sidebar, previous and next, the home and kind pages, search, Markdown twins, `llms.txt` and the assistant all follow it, and pages built ahead list only what a signed-out reader may open. A closed guide answers with a 404, or with `"denied": "teaser"` its title and a 403. Sample `readers` give the build a table of who opens what, link warnings, and a View as menu in `ac site --dev`.
  - A server site searches on the server, ranking pages with more of the query's words first. Results show each page's summary or its opening words, a count and the matched words in bold, and offer the assistant when nothing matches. `autocatalog-docs-astro/search` exports `searchSite()` and `SearchPage` for a search page of your own.
  - `chat` adds an assistant from the new `autocatalog-chatbot` package, built on the AI SDK and shadcn/ui. It answers from the pages the reader may open, links what it used and reports gaps. You set its prompts, words, icons, layout and size, and middleware can change it per reader through `locals.chat`. Every answer ends in a reply: its last step can only report a gap, and the reply follows. Its panel is parts you can compose, from `ChatRoot` to `useChatPanel()`, and `chat.panel` names a component of your own built from them.
  - `"repo"` names a single repository, and `"atRoot": true` publishes its documents at the site's root while ids keep the name.
  - `docs/meta.json` sets `audience` and `access` per folder, nested folders included, and labels nested sidebar groups.
  - The access module's `onDenied` is told each refusal, `locals.denied` names the document, and the assistant's `onAsked` and `onAnswered` get the request. A site's own page replaces the built-in search, no-access, 404 and chat routes, and the site's own dependencies load from its `node_modules`.
  - `url` sets where the site is deployed, for the sitemap and `llms.txt`. A page's summary is left out under its title when the page opens with the same words, a header with sections keeps room for the search box and scrolls the sections past it, and a page without a sidebar has no sidebar toggle.
  - `ac site --dev` serves each project from its own folder, in the foreground.
  - `"pageActions": false` drops the Markdown copy and pin. `docsCatalog()`, `docHref()` and `loadSiteAccess()` serve your own pages and config.
  - A repository whose `docs/meta.json` is not valid has its documents left out until it is fixed. OpenAPI webhook schemas resolve their `$ref`s on their own.

### Patch Changes

- Updated dependencies [ab0b648]
  - autocatalog-docs-core@0.10.0
  - autocatalog-core@0.10.1
  - autocatalog-chatbot@0.1.0
  - autocatalog-agents-core@0.3.3

## 0.12.0

### Minor Changes

- f5c7ed5: - Entities take `lifecycles`, flow steps take `transition`, `rules`, `stuck` and `code`, and `ac flows verify` records what backs each transition.
  - A `finding` document records what an investigation taught and attaches to a flow step.
  - The MCP server adds `flow_context`, `ask` and `read_document`. `--company` answers across repositories, `--allow-writes` adds `propose_finding`, and `audience:` keeps a document to named groups.
  - `--pages` publishes Markdown in the site's layout, and `ac docs import` brings in exported pages.
  - OpenAPI operations join the graph as endpoints. Declare callers with `calls` in `autocatalog.consumes.json`, or let traces find them by `http.route`, and `ac drift --consumers` names them on a breaking change.
  - `autocatalog.lock.json` pins each service to the repository that owns it, and only that repository narrows what its service reads.
  - `autocatalog-plugin-kong` (`ac from-kong`) and `autocatalog-plugin-kubernetes` (`ac from-kubernetes`) put a gateway's routes and a cluster's network policy beside the contracts, and the site reports where they disagree.

### Patch Changes

- Updated dependencies [f5c7ed5]
  - autocatalog-core@0.10.0
  - autocatalog-docs-core@0.9.0
  - autocatalog-agents-core@0.3.2

## 0.11.0

### Minor Changes

- 95f623d: - `ac federation lock` pins releases with `--latest-tag` and `--ref`, and event pages show the release.
  - `ac federation status` names consumers on an earlier release, and each event's Versions card shows what upgrading changes.
  - Components join the catalog. Commit `autocatalog.components.json`, or run `ac from-storybook` from the new `autocatalog-plugin-storybook`, and `/components`, `/owners`, `--index` and `llms.txt` list them. Plugins publish through `writeComponents`.

### Patch Changes

- Updated dependencies [95f623d]
  - autocatalog-core@0.9.0
  - autocatalog-agents-core@0.3.1
  - autocatalog-docs-core@0.8.1

## 0.10.0

### Minor Changes

- ffa29c9: - MCP servers join the catalog. `ac agents discover --from mcp` finds the servers a repository uses and builds, `ac mcp-sweep --owner <owner>` inventories a GitHub owner, and `/mcp-servers` lists each server with its owners, users and tools.
  - `ac agents snapshot` saves each server's tools per connection and reports changes with the agents they reach, from `2026-07-28` and older servers or from Executor. `ac agents audit` and `ac agents drift` check servers and tools.
  - `sources` in `contracts/autocatalog.conventions.json` maps events a team keeps its own way, with no code to run. `ac scan` and `ac drift` take `--conventions <file>`, so a company can share one file.
  - `autocatalog.site.json` sets a site's title, topic, brand, theme and navigation. `brand/` holds your logo, favicon and `theme.css`, and five accent themes ship built in.
  - `docs/meta.json` lets a repository name itself, order its folders and own its pages with one line. The home page shows each repository with its description.
  - `ac check` covers a repository's documents, contracts, events and drift in one command. `actions/check` and `actions/site` run it and the site in GitHub Actions, and `ac site --fingerprint` lets a scheduled build skip a site with nothing new.
  - Diagrams with `%% narrate` lines play step by step, read aloud, and ` ```mermaid interactive ` lets you click through them. Documents render asides and heading links.
  - `ac site` keeps your last good site when every document is left out, and generated examples follow local `$ref`s and sample `anyOf` and `oneOf`.
  - JSON Schemas for event manifests, agent-system kinds, conventions, `docs/meta.json` and `autocatalog.site.json` ship under each core package's `contracts/`.
  - Adapters are now plugins: `autocatalog-plugin-zod` replaces `autocatalog-adapter-zod`, and a package is named `autocatalog-plugin-<name>` and declares `autocatalog.plugin`. Existing packages keep working.

### Patch Changes

- Updated dependencies [ffa29c9]
  - autocatalog-core@0.8.0
  - autocatalog-agents-core@0.3.0
  - autocatalog-docs-core@0.8.0

## 0.9.0

### Minor Changes

- 80c26b1: - Federation. `ac site` composes autocatalog repositories and EventCatalog projects into one company site, and leaves their checkouts untouched. `ac federation lock` pins each enrolled repository to a commit in `autocatalog.lock.json`, and `ac site` builds those commits, checking each tree. The token goes only to GitHub over HTTPS. `ac federation status` lists each source's pin and resources, references that don't resolve, and ids two repositories define. `--index` joins another site's `/catalog.json` into the graph.
  - `autocatalog.consumes.json` takes `receives` and `sends`: events and commands another repository owns, by id or `domain/id`, with an exact version, `latest` or a range such as `^1`. A range picks from the publisher's git history too.
  - `ac delivery` traces each event to its consumers through the broker's own configuration: RabbitMQ `definitions.json`, CloudFormation for SNS, SQS, EventBridge and IAM, Strimzi for Kafka, and ARM for Azure Service Bus. It names the rule and line behind each hop, flags routes, filters, dead-letter queues, retention, retries and identities, and marks each finding confirmed, policy, possible or unknown. Event pages draw the path.
  - `ac delivery verify --disposable` delivers each committed example to a test RabbitMQ and checks the declared routes, recovery and attempt limits.
  - `ac drift --consumers` checks a change against the broker configuration, events and consumers that other repositories publish, and names each consumer the change breaks. Findings show every queue, rule and service name as code.
  - `ac site` leaves out the documents of a repository whose frontmatter breaks the contract, names the file, and builds the rest. Each `ac site` run builds in a folder of its own.
  - `ac site <repo>` builds a repository that publishes only `contracts/` or `autocatalog.consumes.json`. Scans skip `target/`, `bin/` and `obj/`.
  - New guide and examples: events and APIs from Rust, Go, Java and .NET, and a federation of team repositories checked by `pnpm verify:federation`.

### Patch Changes

- Updated dependencies [80c26b1]
  - autocatalog-core@0.7.0
  - autocatalog-docs-core@0.7.0
  - autocatalog-agents-core@0.2.6

## 0.8.0

### Minor Changes

- 80cb2b2: - `task_context` gives an agent what to read before a task: the services, contracts, decision records, runbooks and owners its words name, how each relationship is known, and what the catalog could not establish. `--site` reads the company site's `/catalog.json` so the bundle covers every repository.
  - A breaking drift finding shows a payload the new schema accepts and the current contract rejects, with the check it fails.
  - Glossary terms take `aliases` and `about`, so a business word leads to the services and events that implement it.
  - New `/channels` and `/systems` pages, `[[kind|id]]` links in prose, pinned pages in the sidebar, a resizable sidebar, status banners, field lineage on schema trees, `?embed=1`, and a home page that counts what needs attention.

### Patch Changes

- Updated dependencies [80cb2b2]
  - autocatalog-core@0.6.0
  - autocatalog-docs-core@0.6.0
  - autocatalog-agents-core@0.2.5

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
