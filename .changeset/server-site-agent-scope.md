---
'autocatalog-docs-core': patch
'autocatalog-docs-astro': patch
'autocatalog-cli': patch
'autocatalog-mcp': patch
---

A server site with `access` or an `audience` serves Markdown twins, `llms-full.txt`, the documents in `llms.txt` and `/mcp`. Any other server site turns `/mcp` on with `"mcp": true`. `/mcp` takes requests from other origins on a site for an audience, answers lists 50 at a time with a cursor for the next page, and returns a JSON-RPC error when a request fails. `list_documents` pages the same way.
