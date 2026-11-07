---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-mcp': minor
'autocatalog-plugin-kong': minor
'autocatalog-plugin-kubernetes': minor
---

- Entities take `lifecycles`, flow steps take `transition`, `rules`, `stuck` and `code`, and `ac flows verify` records what backs each transition.
- A `finding` document records what an investigation taught and attaches to a flow step.
- The MCP server adds `flow_context`, `ask` and `read_document`. `--company` answers across repositories, `--allow-writes` adds `propose_finding`, and `audience:` keeps a document to named groups.
- `--pages` publishes Markdown in the site's layout, and `ac docs import` brings in exported pages.
- OpenAPI operations join the graph as endpoints. Declare callers with `calls` in `autocatalog.consumes.json`, or let traces find them by `http.route`, and `ac drift --consumers` names them on a breaking change.
- `autocatalog.lock.json` pins each service to the repository that owns it, and only that repository narrows what its service reads.
- `autocatalog-plugin-kong` (`ac from-kong`) and `autocatalog-plugin-kubernetes` (`ac from-kubernetes`) put a gateway's routes and a cluster's network policy beside the contracts, and the site reports where they disagree.
