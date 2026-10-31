# autocatalog-mcp

## 0.4.0

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

## 0.3.1

### Patch Changes

- 1ff9943: - Edit a design on EventCatalog Studio's canvas under `ac site` dev. The panel beside it shows what the design adds, who owns each catalog resource it touches, and what a runtime snapshot saw on each relation. New parts carry a dashed outline. ⌘S writes `designs/<id>.md`, one line per resource and relation, ready to commit.
  - Start a design from `/designs`. When an agent, an editor or another tab writes the file, the open canvas loads it in place and asks first if you have unsaved changes.
  - Designs take `hotspots:`, listed first on the design page.
  - Click a node on a map to see its card, with a button to its page.
  - The Versions card on an event shows each version's changes as a timeline.
  - MCP tools return compact JSON.
- Updated dependencies [1ff9943]
  - autocatalog-docs-core@0.5.0

## 0.3.0

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

## 0.2.0

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

### Patch Changes

- Updated dependencies [3968aaa]
- Updated dependencies [96719f9]
  - autocatalog-docs-core@0.3.0
  - autocatalog-core@0.4.0
  - autocatalog-agents-core@0.2.3

## 0.1.2

### Patch Changes

- Updated dependencies [5cd0cb5]
- Updated dependencies [59855f0]
  - autocatalog-core@0.3.0
  - autocatalog-agents-core@0.2.2

## 0.1.1

### Patch Changes

- Updated dependencies [98b459d]
  - autocatalog-core@0.2.0
  - autocatalog-agents-core@0.2.1

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
  - autocatalog-agents-core@0.2.0
