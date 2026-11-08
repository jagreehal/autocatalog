---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-mcp': minor
'autocatalog-chatbot': patch
---

A public site gives each OpenAPI reference Scalar's full layout below the site's header, with its own sidebar, search and request client. With one API, **API reference** opens it directly, and a site with guides and an API gets **Documentation** and **API reference** in the header. `"apiReference": "embedded"` keeps the reference inside the site's navigation.

A site with `"output": "server"` serves an MCP endpoint at `/mcp`. Agents connect by URL and get `search_docs`, `list_pages` and `read_page` over the pages, and `list_operations` and `get_operation` over each API, with the API it belongs to and the auth, servers and schemas it needs. It follows `access`, `llms.txt` names it, and Scalar's Connect MCP button installs it. `"mcp": false` leaves it out. Markdown copies, `llms.txt` and `llms-full.txt` render per request on a server site, behind the site's own gate.

Scalar takes the site's colours, font and corners, and a `theme.css` copied from a shadcn app works as it is. Page actions sit in a light row with dividers, and Copy shows a tick when it copies.

`autocatalog-mcp` adds `list_documents`. `read_document` takes a source without `.md` or a repository and names the closest pages when it misses. Both MCP servers tell a client which tool to call first.

A server site resolves the packages its own package.json names from its project, and everything else from autocatalog's.
