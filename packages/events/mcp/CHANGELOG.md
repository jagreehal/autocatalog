# autocatalog-mcp

## 0.6.1

### Patch Changes

- Updated dependencies [9451b43]
  - autocatalog-core@0.11.0
  - autocatalog-docs-core@0.12.0
  - autocatalog-agents-core@0.3.5

## 0.6.0

### Minor Changes

- ac55524: A public site gives each OpenAPI reference Scalar's full layout below the site's header, with its own sidebar, search and request client. With one API, **API reference** opens it directly, and a site with guides and an API gets **Documentation** and **API reference** in the header. `"apiReference": "embedded"` keeps the reference inside the site's navigation.

  A site with `"output": "server"` serves an MCP endpoint at `/mcp`. Agents connect by URL and get `search_docs`, `list_pages` and `read_page` over the pages, and `list_operations` and `get_operation` over each API, with the API it belongs to and the auth, servers and schemas it needs. It follows `access`, `llms.txt` names it, and Scalar's Connect MCP button installs it. `"mcp": false` leaves it out. Markdown copies, `llms.txt` and `llms-full.txt` render per request on a server site, behind the site's own gate.

  Scalar takes the site's colours, font and corners, and a `theme.css` copied from a shadcn app works as it is. Page actions sit in a light row with dividers, and Copy shows a tick when it copies.

  `autocatalog-mcp` adds `list_documents`. `read_document` takes a source without `.md` or a repository and names the closest pages when it misses. Both MCP servers tell a client which tool to call first.

  A server site resolves the packages its own package.json names from its project, and everything else from autocatalog's.

- 8258ffd: Flows draw as EventStorming boards: stages, actors, commands, policies, read models, tracks and Given, When, Then scenarios, with a hotspot for each failure that has no policy. `ac flows draft` drafts a flow from an Effect v4 program, and `<Storm>` and `<Sticky>` work in MDX.

  `/services/` lists every service with its owner, APIs, events and calls, from events, OpenAPI specs or both. CODEOWNERS sets the owner of services, endpoints, gateways and repositories.

  Each API's Scalar reference opens in a frame beside the site's navigation, in its theme, with the reader's place in the address. The sidebar link reads "Scalar" unless you set `apiReferenceLabel`.

  A rail holds the site's sections, from `nav` with an optional `icon`, and the sidebar shows the current section under its name. Page changes fade, and a change of section slides the sidebar. The sidebar draws repositories as headings, folders with folder icons and pages with their kind's icon.

  Sites use grey neutrals, Inter for text and JetBrains Mono for code. The home page opens with count cards, chosen by `homeCounts`, and the architecture map. Maps size to their graph, a flow's walkthrough starts from a button above its map, filters keep text typed while the page loads, and asking a person for help works before the assistant has loaded.

  On Sätteri, Astro's default Markdown processor, Mermaid diagrams, `[[kind|id]]` links, a document's repeated title and scrollable tables work as they do on unified.

### Patch Changes

- b517a68: A server site with `access` or an `audience` serves Markdown twins, `llms-full.txt`, the documents in `llms.txt` and `/mcp`. Any other server site turns `/mcp` on with `"mcp": true`. `/mcp` takes requests from other origins on a site for an audience, answers lists 50 at a time with a cursor for the next page, and returns a JSON-RPC error when a request fails. `list_documents` pages the same way.
- Updated dependencies [ac55524]
- Updated dependencies [7e8b1e0]
- Updated dependencies [8258ffd]
- Updated dependencies [b517a68]
  - autocatalog-docs-core@0.11.0
  - autocatalog-core@0.10.2
  - autocatalog-agents-core@0.3.4

## 0.5.1

### Patch Changes

- Updated dependencies [ab0b648]
  - autocatalog-docs-core@0.10.0
  - autocatalog-core@0.10.1
  - autocatalog-agents-core@0.3.3

## 0.5.0

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

## 0.4.3

### Patch Changes

- Updated dependencies [95f623d]
  - autocatalog-core@0.9.0
  - autocatalog-agents-core@0.3.1
  - autocatalog-docs-core@0.8.1

## 0.4.2

### Patch Changes

- Updated dependencies [ffa29c9]
  - autocatalog-core@0.8.0
  - autocatalog-agents-core@0.3.0
  - autocatalog-docs-core@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [80c26b1]
  - autocatalog-core@0.7.0
  - autocatalog-docs-core@0.7.0
  - autocatalog-agents-core@0.2.6

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
