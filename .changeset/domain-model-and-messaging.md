---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-mcp': minor
'autocatalog-cli': minor
---

- Keep your domain model beside your docs in EventCatalog's field names: `glossary/`, `entities/`, `data-products/`, `teams/` and `users/`. Each gets a page, a repository with only these folders joins the site, and `ac docs check` checks every file.
- Write docs in `.mdx` with `<Map>`, `<Schema>`, `<Term>` and `<Owner>`, and add your own pages and API routes with `ac site --pages <dir>`. The MCP `define` tool explains a domain word.
- Commands name the queue their handler replies on with `outcome.replyTo`, and `ac to-asyncapi --commands <dir>` writes them with an AsyncAPI `reply`. `ac drift` tells events and commands apart.
- Flow steps name their compensation with `compensated_by`, and the flow page shows each saga run step by step.
- Consumers declare a dead-letter queue in `autocatalog.consumes.json`. Event pages show what each consumer did with its deliveries, and `ac drift --snapshot` reports dead-lettered deliveries and events with two producers.
