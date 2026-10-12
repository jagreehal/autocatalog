---
title: Events from Zod
owner: Maintainers
summary: Define an event once in TypeScript; the catalog, graph and service pages derive from it.
tags:
  - events
  - typescript
related:
  - docs/quick-start
  - docs/events/validation
---

The recommended path for TypeScript teams. You define the schema once in code,
and the adapter converts it to JSON Schema and generates the event folder.

```bash
pnpm add -D autocatalog-adapter-zod
```

```ts
// src/events/payment.ts
import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

export default [
  defineEvent(
    {
      domain: 'payments',
      team: 'Billing',
      producers: ['PaymentService'],
      consumers: ['LedgerService', 'NotificationService'],
      tags: ['pci', 'critical'],
    },
    z.object({
      id: z.string(),
      amount: z.number().positive(),
      currency: z.string(),
      completedAt: z.string().datetime(),
    }),
  ),
];
```

`defineEvent` returns the Zod schema unchanged and attaches the metadata to a
symbol. `z.infer`, `.parse()` and `.safeParse()` all keep working, so the same
object stays your runtime validator.

Metadata can also carry `delivery`, what consumers may rely on about arrival;
see [Delivery](/docs/events/json-schema#delivery).

Generate the event folder:

```bash
ac from-zod ./src/events/payment.ts --out ./events
```

That writes `events/payments/PaymentCompleted/autocatalog.json` with your
metadata, `schema.json` converted from Zod, examples, and a generated
`index.mdx` if you have not written narrative content yet.

## Two export shapes

**Curve shape** — compact, with identity encoded in the name:

```ts
export default [
  {
    name: 'v1.payment.completed',
    description: 'Fires when a payment completes',
    schema: z.object({ id: z.string() }),
    example: { id: 'pay_1' },
  },
];
```

`v1.payment.completed` splits into `version: v1`, `id: payment.completed`,
`domain: payment`.

**Explicit shape** — every field under your control:

```ts
export default [
  {
    id: 'payment.completed',
    version: '1.0.0',
    name: 'Payment Completed',
    summary: 'Fires when a payment completes',
    domain: 'payments',
    producers: ['PaymentService'],
    schema: z.object({ id: z.string() }),
    examples: [{ name: 'success', data: { id: 'pay_1' } }],
  },
];
```

Both shapes work with `defineEvent`. Where both carry the same field, the
explicit one wins.

## What survives the conversion

The catalog's interchange format is JSON Schema, not Zod. Constraints that JSON
Schema can express — types, requiredness, enums, formats, numeric bounds —
survive. Refinements and transforms that only exist at runtime do not, and are
out of scope for the catalog on purpose: the catalog is a contract other
languages read, not a second validator.

## Running it in a scan

`ac scan` can pick up Zod events as part of a whole-repository sweep, but
extracting them means evaluating repository code. That is opt-in:

```bash
ac scan . --out ./events --allow-code-execution
```

Results merge by event id, and extracted Zod wins over inferred JSON Schema for
the same id. See [production operation](/docs/production) for the isolation
model that runtime adapters execute under.
