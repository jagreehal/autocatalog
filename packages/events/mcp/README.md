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

Documented at **[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT. No licence key, no telemetry.
