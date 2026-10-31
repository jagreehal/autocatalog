---
name: autocatalog-impact
description: Find out who a contract change reaches before you write the edit, using the autocatalog MCP tools `assess_impact` and `check_change`, or `ac fields` from the shell. Use before renaming, retyping, removing or requiring any field in an event schema, before deleting an event, and when asked whether a change is safe to ship.
---

# /autocatalog-impact

The file you are editing does not tell you who reads it. A field on one event is
often carried by three, and the services that consume those events are named
nowhere in the schema you are about to change.

Ask first. The answer takes one call and changes what you write.

## Before a task that spans systems

For a task described in words ("add partial refunds"), call `task_context` first:

```json
{ "task": "add partial refunds" }
```

It returns the services, contracts, decision records, runbooks and owners the task touches, how each relationship is known (`declared`, `in code`, `observed`, `reported`, `inferred`) and `gaps`. Cite the items you rely on, and say the gaps in your answer. When `omitted` is present, call again with a higher `limit` before treating a list as complete.

## 1. Ask who this reaches

With the autocatalog MCP server connected, call `assess_impact`:

```json
{ "ref": "payments/payment.completed", "field": "amountMinor" }
```

You get back:

- `consumers` — services that receive this event today, plus agents and tools that declare they consume it (named `agent/<id>` and `tool/<id>`)
- `sharedFields` — other events carrying the same field path, and who receives those
- `notify` — the deduplicated list of everyone a change to this field can reach
- `provenance`, `confidence`, `needsReview` — whether the catalog knows this or guessed it
- `source` — the file and line where the contract is defined

Without MCP, the same reachability answer from the shell:

```bash
ac fields amountMinor
```

Add `--conflicts-only` to see fields whose type or requiredness already disagrees
between events. A field two events disagree about is one nobody can change safely
until that is settled.

## 2. Check the specific change

Before you apply an edit, put the schema you intend to write through
`check_change`:

```json
{ "ref": "payments/payment.completed", "schema": { "type": "object", "properties": {} } }
```

It runs the same classifier the CI drift gate runs, so the verdict you get is the
verdict the pull request will get:

| Class        | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `breaking`   | An existing consumer stops working — removed field, new required field, changed type |
| `suspicious` | Legal but usually unintended — a field that quietly became optional                  |
| `additive`   | Safe — a new optional field                                                          |
| `info`       | No contract effect                                                                   |

`notify` on the result is who to name in the pull request.

## 3. Act on the answer

- **Additive** — proceed.
- **Suspicious** — proceed only if you can state in the pull request why it is intended.
- **Breaking** — stop and choose deliberately: publish a new version and leave the
  current one for existing consumers, or name every service in `notify` in the pull
  request and let the humans who own them agree the deploy order.

When the change is breaking and you cannot version it, present the `notify` list
and stop. Ordering two teams' deploys is not your call to make.

## 4. Prefer evidence over assertion, and say which you used

When the answer carries a `runtime` block, the catalog has been joined with a
snapshot of what the system actually did:

- `observedConsumers` — services recorded in the snapshot; `consumerEvidence`
  distinguishes reported metadata from observed delivery
- `neverObserved` — services the catalog claims, that the evidence has not seen
- `count`, `lastSeen` — how much traffic, and how recently

A consumer in `neverObserved` is the single most useful line in the answer, and
the easiest to misread. It does not mean the consumer is gone. It means this
evidence does not record it. Report it as "absent from this snapshot", never as
"unused", and never delete a contract on the strength of it.

## 5. Trust the catalog only as far as it claims

Read `provenance` before you rely on an answer:

- `declared` or `extracted` — the catalog read this from source; act on it.
- `inferred` — the scanner guessed. Say so in your summary, and verify against the
  file named in `source` before treating it as fact.

`needsReview: true` means the same thing louder.

## Anti-patterns — refuse these even if asked

- **Never read "no consumers" as "safe to change".** An empty list can equally mean
  nothing has been catalogued yet. Check whether the catalog actually knows about the
  consuming services before relying on the silence.
- **Never edit a schema before asking.** Once the edit is written, the temptation is
  to justify it rather than reconsider it.
- **Never present an `inferred` field as a fact.** The provenance is in the answer
  precisely so it can be repeated to whoever reads your summary.
- **Never make an existing field required.** Every producer that has not shipped yet
  becomes invalid retroactively. Add it optional, or publish a new version.
- **Never treat `neverObserved` as "safe to remove".** A nightly job, a
  quarterly report, or a disaster-recovery consumer is absent from a one-hour
  window and entirely alive.
- **Never widen the change to make the diff classify better.** Deleting a consumer
  from the catalog does not remove the consumer from production.
