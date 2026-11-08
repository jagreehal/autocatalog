# public-api

Branded API docs for developers outside the company, from the same convention
the company's own catalog reads: a generated `contracts/openapi.yaml` and guides
under `docs/`.

```bash
npx autocatalog site .
```

`"audience": "public"` in `autocatalog.site.json` publishes the two guides that
name `audience: [public]` and the Payments API reference. The runbook names no
audience, so it stays internal, as do the operations marked `x-internal: true`,
the `ReconcileJob` schema only they use, the Operations tag and the
`x-autocatalog` service names. Without the field, the same repository builds
the company's own view of it.
