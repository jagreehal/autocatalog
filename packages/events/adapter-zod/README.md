# autocatalog-adapter-zod

Make a Zod schema the catalog entry.

```ts
import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

export default [
  defineEvent(
    { domain: 'payments', team: 'Billing', producers: ['PaymentService'] },
    z.object({ id: z.string(), amount: z.number().positive() }),
  ),
];
```

`defineEvent` returns the schema unchanged, so `z.infer` and `.parse()`
keep working. `ac scan . --allow-code-execution` reads these into `events/`.

Documented at **[jagreehal.github.io/autocatalog](https://jagreehal.github.io/autocatalog)**.

MIT. No licence key, no telemetry.
