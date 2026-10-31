# autocatalog-mcp

An MCP server over stdio that lets a coding agent query the event catalog and
ask what a change breaks.

```json
{
  "mcpServers": {
    "autocatalog": {
      "command": "node",
      "args": ["node_modules/autocatalog-mcp/dist/index.js", "--root", "."]
    }
  }
}
```

It reads the catalog from disk and makes no network calls.

Add `--site https://catalog.example.com` and `task_context` reads the company
site's `/catalog.json` too, so an agent asking for the context of a task
("add partial refunds") gets every repository's services, decision records,
runbooks and owners, with how each relationship is known and what the catalog
could not establish. For a private site, `--site-token-env CATALOG_TOKEN` sends
that variable as a bearer token. Without `--site`, `task_context` searches this
repository only and says so.

Documented at **[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT. No licence key, no telemetry.
