# autocatalog-agents-mcp

## 0.2.5

### Patch Changes

- 1ff9943: - Edit a design on EventCatalog Studio's canvas under `ac site` dev. The panel beside it shows what the design adds, who owns each catalog resource it touches, and what a runtime snapshot saw on each relation. New parts carry a dashed outline. ⌘S writes `designs/<id>.md`, one line per resource and relation, ready to commit.
  - Start a design from `/designs`. When an agent, an editor or another tab writes the file, the open canvas loads it in place and asks first if you have unsaved changes.
  - Designs take `hotspots:`, listed first on the design page.
  - Click a node on a map to see its card, with a button to its page.
  - The Versions card on an event shows each version's changes as a timeline.
  - MCP tools return compact JSON.

## 0.2.4

### Patch Changes

- autocatalog-agents-core@0.2.4
  - autocatalog-agents-adapter-autotel@0.2.4

## 0.2.3

### Patch Changes

- autocatalog-agents-core@0.2.3
  - autocatalog-agents-adapter-autotel@0.2.3

## 0.2.2

### Patch Changes

- autocatalog-agents-core@0.2.2
  - autocatalog-agents-adapter-autotel@0.2.2

## 0.2.1

### Patch Changes

- autocatalog-agents-core@0.2.1
  - autocatalog-agents-adapter-autotel@0.2.1

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
  - autocatalog-agents-adapter-autotel@0.2.0
