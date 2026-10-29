---
title: Cross-domain delivery
owner: Maintainers
summary: What autocatalog enforces when work crosses a domain boundary, step by step, and what it leaves to people.
tags:
  - ci
  - governance
related:
  - docs/drift-ci
  - docs/events/json-schema
  - docs/events/validation
---

A dependency between domains should create a contract, not shared ownership.
When work crosses a boundary, the teams agree the interaction first and build
against it in parallel. This page maps each step of that to what autocatalog
checks, so the agreement is enforced in CI rather than kept on a wiki.

Some steps are decisions only people can make. They are listed as such, and
nothing here pretends otherwise.

## 1. Know who owns it

Every event, table and service carries an owner, read from its manifest,
`catalog-info.yaml`, a Datadog import or CODEOWNERS. A repository that tries to
redefine a resource another repository declares is quarantined and named, and
the owners page lists what each team owns.

```bash
ac health --min 70   # an event with no owner loses points
```

## 2. Describe the capability, not the implementation

A people decision. What autocatalog does is catch the commonest leak: a service
that starts reading another team's table fails the pull request.

```text
checkout (payments) reads table finance/eligibility, which finance owns
```

## 3. Choose the interaction

Events, commands (one handler, an expected outcome), webhooks, endpoints and
queues are all catalogued. Choosing between them stays with the teams, and the
gate keeps each one what it says it is: an event two services publish is
suspicious, and a new event that does not read as something that happened, or
a command that does, is noted. A command whose sender waits for the result
names the queue the handler replies on with `outcome.replyTo`.
Direct database access across domains is the one choice that is enforced: see
[another team's datastore](/docs/drift-ci#another-teams-datastore). A deliberate
exception, such as a migration, is reviewed with `ac resources promote`.

## 4. Define the contract first

Write it as Zod, Pydantic, JSON Schema, OpenAPI, AsyncAPI, Avro or protobuf;
all of them become one versioned, validated contract. What arrival looks like
is part of it too:

```json
"delivery": {
  "guarantee": "at-least-once",
  "orderingKey": "orderId",
  "idempotencyKey": "orderId",
  "correlationKey": "meta.traceId",
  "maxLateness": "PT5M"
}
```

`ac validate` fails a key the schema does not have. See
[delivery](/docs/events/json-schema#delivery).

## 5. Agree examples, not just schemas

Put each edge case in a folder named for it:

```text
examples/
  placed.json                  the happy path
  empty/no-lines.json
  partial/no-address.json
  duplicate/redelivered.json   repeats another example's idempotency key
  late/after-outage.json
  invalid/no-total.json        must fail the schema
```

An `invalid` example that the schema accepts fails validation: it was meant to
show consumers what to reject. A `duplicate` that repeats no other example's
idempotency key is a warning. `ac health` asks every event for at least one
edge case, and an at-least-once event for a duplicate. EventCatalog renders the
same folders as they are.

## 6. Build in parallel

```bash
ac to-asyncapi --service billing --out billing.asyncapi.yaml
```

writes one service's view as AsyncAPI 3.0, with every valid example and the
correlation id, for a mock server such as Microcks to serve while the provider
is still being built. Invalid examples are left out, since a mock would serve
them as real messages. The document carries EventCatalog's
`x-eventcatalog-message-*` extensions, so EventCatalog's AsyncAPI generator
reads it, and `ac from-asyncapi` brings it back without losing anything.

## 7. Test the boundary automatically

```bash
ac drift --base-ref origin/main
```

Breaking changes fail the pull request and name the consumers they reach,
narrowed by the fields each consumer says it reads. See
[drift gating](/docs/drift-ci). Consumer-driven pact suites are a different
tool, and complement this rather than replace it.

Each side tests against the contract, not against the other side. The
producer's tests show it publishes what it declares: the snapshot they write
is checked by `ac drift --snapshot`. The consumer's tests feed it the event's
examples, edge cases included, and check it handles them. Neither needs the
other running, or a broker.

## 8. Preserve ownership

Reading or writing another team's datastore is enforced (step 2). Copying
another domain's business rules into your own code is not detected: telling a
copied rule from a coincidence is guesswork, and a guess in a CI gate is worse
than none.

## 9. Design failure behaviour

Three of the questions have an answer the contract can hold and CI can check:
duplicates (`guarantee` and `idempotencyKey`), order (`orderingKey`) and
lateness (`maxLateness`). A consumer declares where it puts a delivery it gives
up on with `deadLetter` in `autocatalog.consumes.json`, and the snapshot from
its tests says how many deliveries failed, were retried or were dead-lettered,
and why ([delivery outcomes](/docs/runtime-evidence#delivery-outcomes)). A
process that has to undo earlier steps when a later one fails names the step
that undoes each one with `compensated_by` in its
[flow](/docs/site). Stale data and whether to fail open or closed are runtime
design, and stay with the team.

## 10. Make it observable

`ac health` asks each event for a correlation field: one under a common name
(`correlationId`, `traceId`, `traceparent`, `causationId`), one named by
`delivery.correlationKey`, or a CloudEvents envelope. Traces imported with
`ac resources scan --traces` add what actually ran to the graph, and the MCP
server's investigation bundle hands a failing journey to autotel.

## 11. Define change rules

The [severity model](/docs/drift-ci#severity-model) is the change rulebook:
adding an optional field is safe, removing one is breaking, and so is a longer
maximum lateness or a changed ordering key. A major version acknowledges a
breaking change. A change of meaning with no change of shape cannot be seen in
a schema; a changed description is reported, for information.

## 12. Have an escape hatch

Collaboration while a boundary is still being found is a people matter. The
tools give it an end state: `ac resources promote` records a reviewed
exception, and a major version records a deliberate break. Both stay visible,
so temporary coupling does not quietly become permanent.
