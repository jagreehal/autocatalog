# autocatalog

```bash
npx autocatalog .
```

Scans the repository for event contracts — JSON Schema, OpenAPI, Avro, protobuf,
and Zod with `--allow-code-execution` — and writes a catalog to `events/`,
reporting what it found, what it had to guess, and whether to commit it.
`npx autocatalog site . --dev` serves a site from `contracts/` and `docs/`
without writing anything.

This package is the front door and nothing else. It installs
[`autocatalog-cli`](https://www.npmjs.com/package/autocatalog-cli) and runs it,
so `npx autocatalog .` and `ac scan .` are the same command.

Everything else — the site, drift gating in CI, the docs convention, the MCP
server, agent catalogs — is documented at
**[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT, including every AI surface. No licence key, no telemetry.
