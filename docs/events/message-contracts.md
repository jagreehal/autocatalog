---
title: Events from autotel-message-contract
owner: Maintainers
summary: Approved message contracts become catalog events; the contract tests pin the bytes, autocatalog catalogs them and gates their drift.
tags:
  - events
related:
  - docs/events/json-schema
  - docs/drift-ci
---

[`autotel-message-contract`](https://github.com/jagreehal/autotel/tree/main/packages/autotel-message-contract)
pins a message's serialized shape as an ordinary unit test:

```ts
messageContract({ snapshot: 'PaymentCaptured' })
  .given(new PaymentCaptured('pay-1', 4250))
  .whenSerialized()
  .thenContractIsUnchanged();
```

The first run writes the serialized message to
`__contracts__/PaymentCaptured.approved.txt` beside the test, and from then on
the test fails when the bytes change. That file is what autocatalog reads. The
two split the work:

- **The contract test pins the bytes.** Your serializer, your fixtures, run in
  your test suite, failing the moment the format moves. Compatibility checks
  between versions (`thenBackwardCompatible`) live there too.
- **autocatalog catalogs and gates.** It turns each approved file into an event
  page with an example, and runs `ac drift --base-ref` over it like any other
  contract: a renamed field names the consumers that read it.

Nothing runs: `ac scan` reads the committed files. autotel does not need to be
installed, and the tests are never executed.

## What is read

Every `*.approved.txt` directly inside a `__contracts__/` directory, anywhere
in the repository, except under `node_modules`, `dist` and the other
directories no scan enters. The directory and suffix belong to the tool, so the
scan cannot mistake a test fixture for a contract.

| From the file                       | Becomes                                       |
| ----------------------------------- | --------------------------------------------- |
| `PaymentCaptured`                   | id `payment.captured`, name `PaymentCaptured` |
| `PaymentCaptured_v2` (`-v2`, `.v2`) | version `2.0.0`                               |
| no version in the name              | version `0.1.0`, inferred                     |
| the directory above `__contracts__` | the domain, inferred                          |
| the JSON bytes                      | the example `approved`                        |
| the JSON bytes                      | the payload schema, inferred                  |

The approved file is one message, not a schema, so the schema claims only what
that message shows: each field's type (`number` for any number, nothing for a
`null`), and no field `required`. One message shows a field present, not that
every message carries it. Removing or renaming a field is still breaking;
adding one is additive. The schema is marked `inferred` in provenance and the
event needs review until its id and version are declared.

When the same event is also declared as a JSON Schema, Zod or anything else
with a written schema, that one wins and `ac scan` prints the conflict.

## Declaring what the bytes cannot say

A sidecar beside the approved file supplies the metadata a serialized message
has no room for. `__contracts__/PaymentCaptured.approved.autocatalog.json` takes
the same fields as `x-autocatalog`:

```json
{
  "id": "payment.captured",
  "version": "2.0.0",
  "producers": ["PaymentService"],
  "consumers": ["LedgerService", "EmailService"],
  "consumerFields": { "LedgerService": ["paymentId", "amount"] }
}
```

With `id` and `version` declared the event no longer needs review, and drift
can name who a change breaks.

## What is skipped, and said

`ac scan` lists every approved file it did not catalog, with the reason:

- **An earlier version** (`PaymentCaptured_v1` beside `PaymentCaptured`): kept
  for `approvedSnapshot()` replay, not a separate event. The unversioned file,
  or else the highest version, is cataloged.
- **Not JSON** (a protobuf or other binary codec): the payload shape cannot be
  read from it. Declare the event with a JSON Schema, Avro or `.proto` file.

## Where `ac site` finds them

`ac site` reads a repository's committed `events/`, or, without one, its
`contracts/` and every approved file anywhere in it: `*.approved.txt` directly
inside a `__contracts__/` directory, a regular file, outside `node_modules`,
`dist` and dot-folders. So approved files beside their tests publish with no
`ac scan` and no committed `events/`. The pattern is that strict on purpose:
nothing else outside `contracts/` is read, because a repository's test fixtures
are not what it publishes. `ac scan` and `ac drift --base-ref` find them the
same way.
