# autocatalog-agents-adapter-autotel

## 0.3.0

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
  - autocatalog-agents-core@0.3.0

## 0.2.6

### Patch Changes

- autocatalog-agents-core@0.2.6

## 0.2.5

### Patch Changes

- autocatalog-agents-core@0.2.5

## 0.2.4

### Patch Changes

- autocatalog-agents-core@0.2.4

## 0.2.3

### Patch Changes

- autocatalog-agents-core@0.2.3

## 0.2.2

### Patch Changes

- autocatalog-agents-core@0.2.2

## 0.2.1

### Patch Changes

- autocatalog-agents-core@0.2.1

## 0.2.0

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
  - autocatalog-agents-core@0.2.0
