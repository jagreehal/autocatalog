---
'autocatalog-core': minor
'autocatalog-mcp': minor
'autocatalog-cli': patch
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
---

- `task_context` gives an agent what to read before a task: the services, contracts, decision records, runbooks and owners its words name, how each relationship is known, and what the catalog could not establish. `--site` reads the company site's `/catalog.json` so the bundle covers every repository.
- A breaking drift finding shows a payload the new schema accepts and the current contract rejects, with the check it fails.
- Glossary terms take `aliases` and `about`, so a business word leads to the services and events that implement it.
- New `/channels` and `/systems` pages, `[[kind|id]]` links in prose, pinned pages in the sidebar, a resizable sidebar, status banners, field lineage on schema trees, `?embed=1`, and a home page that counts what needs attention.
