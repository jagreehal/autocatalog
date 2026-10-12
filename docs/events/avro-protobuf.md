---
title: Events from Avro and protobuf
owner: Maintainers
summary: Passive discovery over .avsc and .proto files, with the wire-format semantics kept intact.
tags:
  - events
related:
  - docs/events/json-schema
  - docs/drift-ci
---

Both are read by `ac scan` with no configuration and no code execution:

```bash
ac scan . --out ./events
```

## Avro (`.avsc`)

Every `.avsc` holding a record becomes an event. Only `.avsc` — an Avro schema
is legal JSON, but so is everything else in a repository, and guessing which
`.json` files are Avro is how a scan starts inventing events.

| Avro                   | JSON Schema                                    |
| ---------------------- | ---------------------------------------------- |
| `record`               | `object` with `properties`                     |
| `["null", "string"]`   | `string`, and the field is optional            |
| `enum`                 | `string` with `enum`                           |
| `array` / `map`        | `array` / `object` with `additionalProperties` |
| `long` + `logicalType` | the matching `format` (`date-time`, `uuid`)    |
| `fixed`, `bytes`       | `string`                                       |

A field is optional when it is a null union **or** carries a `default`.
Everything else is required — Avro has no implicit default, so a field without
one must be written. Note this differs from protobuf, where repeated fields
default to empty.

Identity comes from the record name (`com.acme.PaymentCompleted` →
`payment.completed`), the domain from the namespace. Declare either explicitly
with an `x-autocatalog` block in the schema to clear `needsReview`.

## Protobuf (`.proto`)

Messages become events, with two deliberate exclusions:

- **Messages wired to an RPC.** A request/response pair is a call, not a message
  anyone subscribes to. Publishing both halves of every gRPC method is how a
  catalog fills with things nobody emits.
- **Nested messages.** They are the structure of their parent, not events.

Types follow proto3's canonical JSON mapping, which is what actually travels on
a bus — so `int64` is a `string`, not a number, because JSON cannot hold it.
`google.protobuf.Timestamp` becomes `date-time`.

Required-ness follows proto3 presence: a singular field without `optional`
always decodes to a value, so it is always in the payload a consumer sees;
`optional`, `repeated` and `map` fields may be absent or empty.

Declare identity with an option on the message:

```proto
message OrderPlaced {
  option (autocatalog.id) = "order.placed";
  option (autocatalog.version) = "2.0.0";
  string order_id = 1;
}
```

Imports are not resolved off disk. A type from another file scans as an empty
schema rather than a guess — the catalog says it does not know instead of
pretending.
