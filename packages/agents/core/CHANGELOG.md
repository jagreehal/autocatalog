# autocatalog-agents-core

## 0.4.1

### Patch Changes

- Updated dependencies [63029e8]
  - autocatalog-core@0.13.0

## 0.4.0

### Minor Changes

- 75a8ff7: Event, API, specification, entity, data product and data model pages end with the day their file last changed, as documents do. An event discovered from code takes the date of the file it came from. Git dates every page; with no repository, an uncommitted file or a shallow clone, the page shows no date.

  The home page lists what changed most recently, documents and resources together, under the architecture map. Name the `recent` block in `layouts.home` to place it. A site for an `audience` does not publish it.

  `ac agents discover --from skills` lists the agent skills and Claude Code plugins a repository commits: every `SKILL.md`, slash command and Cursor rule with its `allowed-tools`, each plugin with the skills, subagents, commands, hook events and MCP servers it ships, each marketplace, and the plugins `.claude/settings.json` turns on. They become `skill` and `agent-plugin` entries in `agent-skills/` and `agent-plugins/`, with an owner, and join the graph: a repository defines and uses plugins, and a plugin defines its skills. `.claude/settings.local.json` and your home folder are never read.

  `--check` exits 1 when the files no longer match the committed entries, and marks a new allowed tool, hook or MCP server for review.

  `/skills` on the site lists every plugin and skill, and `ac mcp-sweep` reads them across a GitHub owner too. Two repositories can each keep a skill or a plugin of one name. Paths a plugin manifest names are read only when they resolve inside the repository, links included.

  MCP discovery also reads the servers a plugin declares in `.claude-plugin/plugin.json`.

  The check action is the company gate. `consumers` names the consumers other repositories declare, `require-consumers` fails when the company site cannot be read, and `max-consumers-age` fails on a stale one; `ac check` and `ac drift` take the same as `--consumers`, `--require-consumers` and `--max-consumers-age`. The action keeps one pull request comment with the result, through `ac check --comment`, editing only a comment a bot wrote, and runs the autocatalog release it ships with instead of the newest. With `--allow-code-execution`, `ac check` runs installed plugins such as Zod, and drift compares the events they read from source; without it, the contracts and drift steps name the plugins they skipped and check the rest.

  `ac site --strict` publishes nothing when a repository or source is left out, and the site action builds with it by default. Every build writes `/catalog.meta.json`: when it was built, the lock's digest, its size and what it left out.

  `ac federation status --fail-on gateway,network` fails on those findings too, as it can on `unresolved`, `unpinned` and `behind`.

### Patch Changes

- Updated dependencies [75a8ff7]
- Updated dependencies [75a8ff7]
- Updated dependencies [75a8ff7]
  - autocatalog-core@0.12.0

## 0.3.5

### Patch Changes

- Updated dependencies [9451b43]
  - autocatalog-core@0.11.0

## 0.3.4

### Patch Changes

- Updated dependencies [7e8b1e0]
  - autocatalog-core@0.10.2

## 0.3.3

### Patch Changes

- Updated dependencies [ab0b648]
  - autocatalog-core@0.10.1

## 0.3.2

### Patch Changes

- Updated dependencies [f5c7ed5]
  - autocatalog-core@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [95f623d]
  - autocatalog-core@0.9.0

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
  - autocatalog-core@0.8.0

## 0.2.6

### Patch Changes

- Updated dependencies [80c26b1]
  - autocatalog-core@0.7.0

## 0.2.5

### Patch Changes

- Updated dependencies [80cb2b2]
  - autocatalog-core@0.6.0

## 0.2.4

### Patch Changes

- Updated dependencies [bb5e41e]
  - autocatalog-core@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [96719f9]
  - autocatalog-core@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [5cd0cb5]
- Updated dependencies [59855f0]
  - autocatalog-core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [98b459d]
  - autocatalog-core@0.2.0

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
  - autocatalog-core@0.1.0
