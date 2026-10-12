---
title: Events from OpenAPI
owner: Maintainers
summary: Passive discovery over the OpenAPI specs already in a repository — webhooks and callbacks, not every endpoint.
tags:
  - events
related:
  - docs/events/json-schema
  - docs/events/importing
---

If your repository already has an `openapi.yaml`, the scanner reads it. Nothing
to install, no repository code executed, no separate command:

```bash
ac scan . --out ./events
```

## What becomes an event

Three things, and deliberately nothing else:

| In the spec                        | Why it qualifies                      |
| ---------------------------------- | ------------------------------------- |
| `webhooks:`                        | OpenAPI 3.1's own word for "an event" |
| `callbacks:` on an operation       | the same idea, attached to a call     |
| any operation with `x-autocatalog` | someone opted it in explicitly        |

The payload is the operation's JSON request body, with local `$ref` pointers
resolved. The domain comes from the first tag, or `x-autocatalog.domain`.

```yaml
openapi: 3.1.0
webhooks:
  payment.completed:
    post:
      tags: [payments]
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Payment' }
```

## What does not become an event, and why

A plain `POST /payments` is a request/response contract, not a message. Mapping
every endpoint would fill the catalog with CRUD noise — a hundred "commands"
nobody publishes and nobody subscribes to — and a catalog you have to squint
past is one you stop trusting.

So the scanner leaves them alone. If an endpoint really is an event in your
system, say so on the operation and it gets picked up with `extracted`
provenance rather than a guess:

```yaml
paths:
  /payments:
    post:
      operationId: createPayment
      x-autocatalog:
        id: payment.requested
        version: 2.0.0
        domain: payments
```

## Provenance

A webhook with no `x-autocatalog` block is still a guess about `id` and
`version` — it is marked `needsReview` with those fields `inferred`. Declaring
both clears the flag. See [validation](/docs/events/validation) for what the
review step checks.
