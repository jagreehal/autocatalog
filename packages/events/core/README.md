# autocatalog-core

The catalog model the other packages share: event schemas, the loader and
validator, and the `autocatalog/graph-v1` resource graph.

```ts
import { loadCatalog } from 'autocatalog-core';

const events = await loadCatalog('events');
```

The graph contract is published as JSON Schema at
`autocatalog-core/contracts/graph-v1.schema.json`.

Documented at **[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT. No licence key, no telemetry.
