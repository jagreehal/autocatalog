---
title: Events from JSON Schema
owner: Maintainers
summary: Passive discovery over the schema files already in a repository.
tags:
  - events
related:
  - docs/events/zod
  - docs/production
---

If your contracts already exist as JSON Schema — hand-written, or emitted by
another tool — point the scanner at the repository. Nothing else to install, and
no repository code is executed.

```bash
ac scan . --out ./events
```

## Discovery rules

- Files that look like JSON Schema are candidates: `$schema`, `type` with
  `properties`, `$ref` / `allOf`, and similar shapes
- Noise is skipped: `package.json`, `tsconfig*.json`, lockfiles
- Identity comes from `$id`, the filename, or an `x-autocatalog` or
  `x-eventcatalog` block or
  `*.autocatalog.json` sidecar
- Fields that cannot be established are marked `needsReview`, with provenance
  `inferred` — the catalog says it guessed instead of pretending it knew
- Draft 2020-12 is preferred; older drafts are accepted and left as they are

## Embedding metadata

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "id": { "type": "string" } },
  "x-autocatalog": {
    "id": "payment.completed",
    "version": "1.0.0",
    "domain": "payments",
    "classification": "integration",
    "producers": ["PaymentService"]
  }
}
```

`classification` says who an event is for, narrowest to widest: `internal`
(inside the producing service), `domain` (inside its domain), `integration`
(across domains) or `public` (outside the organisation). It is optional; a
wider event is a harder contract to change, and saying so lets a
[policy](/docs/events/validation#project-rules) require it.

### Delivery

A schema says what a payload looks like, not how it arrives. `delivery` says
what consumers may rely on about that:

```json
"x-autocatalog": {
  "id": "payment.completed",
  "delivery": {
    "guarantee": "at-least-once",
    "orderingKey": "paymentId",
    "idempotencyKey": "paymentId",
    "correlationKey": "meta.traceId",
    "maxLateness": "PT5M"
  }
}
```

- `guarantee` is `at-least-once`, `at-most-once` or `exactly-once`. With
  at-least-once, consumers must expect duplicates.
- `orderingKey` is the field events arrive in order by. Two events with the same
  value arrive in the order they were sent; nothing is promised across values.
- `idempotencyKey` is the field that identifies a repeat, so a consumer can
  drop an event it has already handled.
- `correlationKey` is the field that ties the event to the journey it is part
  of, so a trace can follow it. Without one, a field under a common name
  (`correlationId`, `traceId`, `traceparent`, `causationId`) is used.
- `maxLateness` is how long after it happened an event can still arrive, as an
  ISO 8601 duration in days or less (`PT30S`, `PT5M`, `P1D`). A consumer that
  waits this long has seen everything for that moment.

Keys are payload paths, written as in `consumerFields`. `ac validate` fails a
key the schema does not have, and warns about one the schema leaves optional,
since an event without it has no order or cannot be deduplicated. The event
page shows the promise under its details, and drift treats it as part of the
contract: see
[the severity model](/docs/drift-ci#severity-model).

Keep it in a sidecar instead if you do not own the schema file:
`payment.completed.autocatalog.json` beside it.

## Passive by default

`ac scan` reads data files and does not execute repository code. Runtime
adapters — Zod, for instance — have to evaluate code to recover a schema, so
they only run when you say so:

```bash
ac scan . --out ./events --allow-code-execution
```

Candidates from every adapter merge by event id, and conflicts resolve by
provenance and confidence: `extracted` beats `inferred` for the same id.

## One catalog, or none

A scan publishes transactionally. A failing adapter or an invalid event leaves
the previous catalog exactly as it was, rather than half-replacing it. The
mechanics — staging, locks, backups, recovery — are in
[production operation](/docs/production).

## Writing your own adapter

The discovery interface is deliberately small:

```ts
import type { DiscoveryAdapter } from 'autocatalog-core';

export const protobufDiscoveryAdapter: DiscoveryAdapter = {
  name: 'protobuf',
  async discover({ root }) {
    return { candidates: await findProtobufEvents(root), errors: [] };
  },
};
```

Advertise it from the adapter package and `ac` finds it in `node_modules`:

```json
{
  "name": "autocatalog-adapter-protobuf",
  "autocatalog": {
    "adapter": {
      "discovery": {
        "entry": "./dist/index.js",
        "export": "protobufDiscoveryAdapter"
      }
    }
  }
}
```

Each candidate carries its event and the source evidence together. Core owns
conflict resolution, enrichment, validation, stale cleanup and publication;
an adapter only translates its source format into the shared JSON Schema
representation.
