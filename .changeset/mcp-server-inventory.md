---
'autocatalog-core': minor
'autocatalog-cli': minor
'autocatalog-plugin-zod': minor
'autocatalog-agents-core': minor
'autocatalog-agents-cli': minor
'autocatalog-agents-adapter-autotel': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
---

- MCP servers join the catalog. `ac agents discover --from mcp` finds the servers a repository uses and builds, `ac mcp-sweep --owner <owner>` inventories a GitHub owner, and `/mcp-servers` lists each server with its owners, users and tools.
- `ac agents snapshot` saves each server's tools per connection and reports changes with the agents they reach, from `2026-07-28` and older servers or from Executor. `ac agents audit` and `ac agents drift` check servers and tools.
- `sources` in `contracts/autocatalog.conventions.json` maps events a team keeps its own way, with no code to run. `ac scan` and `ac drift` take `--conventions <file>`, so a company can share one file.
- `autocatalog.site.json` sets a site's title, topic, brand, theme and navigation. `brand/` holds your logo, favicon and `theme.css`, and five accent themes ship built in.
- `docs/meta.json` lets a repository name itself, order its folders and own its pages with one line. The home page shows each repository with its description.
- `ac check` covers a repository's documents, contracts, events and drift in one command. `actions/check` and `actions/site` run it and the site in GitHub Actions, and `ac site --fingerprint` lets a scheduled build skip a site with nothing new.
- Diagrams with `%% narrate` lines play step by step, read aloud, and ` ```mermaid interactive ` lets you click through them. Documents render asides and heading links.
- `ac site` keeps your last good site when every document is left out, and generated examples follow local `$ref`s and sample `anyOf` and `oneOf`.
- JSON Schemas for event manifests, agent-system kinds, conventions, `docs/meta.json` and `autocatalog.site.json` ship under each core package's `contracts/`.
- Adapters are now plugins: `autocatalog-plugin-zod` replaces `autocatalog-adapter-zod`, and a package is named `autocatalog-plugin-<name>` and declares `autocatalog.plugin`. Existing packages keep working.
