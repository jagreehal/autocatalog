---
name: autocatalog-drift
description: Find out who a schema change breaks before making it, using `ac drift` and `ac changelog`. Use before editing an event's schema or contract, when a drift check fails in CI, when asked whether a change is breaking, or when planning to remove or rename a field.
---

# /autocatalog-drift

An event contract has consumers you cannot see from the file you are editing. Ask who breaks **before** the change, not after the deploy.

## 1. Compare against the baseline

```bash
ac drift --base-ref origin/main --root .
```

Changes are classified and each is attributed to the services that consume the event:

| Class        | Meaning                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `breaking`   | An existing consumer stops working — a removed or newly required field, a changed type |
| `suspicious` | Legal but usually unintended — a field that quietly became optional                    |
| `additive`   | Safe — a new optional field                                                            |

A breaking or suspicious finding can carry a `rehearsal:` payload, one the new schema accepts and the current contract rejects, with the check it fails. Put it in the pull request, or in a consumer's test, to show the break.

Read the named consumers. That list is the whole point of running this, and it is what a schema differ alone cannot tell you.

Drift also keeps events and commands apart. An event a second service starts publishing is `suspicious`: an event is a fact from one boundary, so split it into one event per publisher, or make it a command one service handles. A new event that does not read as past tense (`order.place`), or a new command that does (`OrderPlaced`), is `info`: rename it, or say why the name fits.

### Consumers in other repositories

The event's manifest lists the consumers its own repository knows. Teams in other repositories declare theirs in `autocatalog.consumes.json`, and the company site publishes them at `/catalog.json`. Read them too:

```bash
ac drift --base-ref origin/main --root . --consumers https://catalog.example.com/catalog.json
```

The output names when that index was published. Declarations made since then are not in it, so mention the date when you report who is affected.

### What the tests sent

When the repository commits an autotel snapshot, check the catalog against what ran too:

```bash
ac drift --base-ref origin/main --root . --snapshot .autotel/snapshot.json
```

A payload the contract forbids (a wrong type, a value outside an enum) is `breaking`. An event, field, producer or channel the code uses but the catalog never declares is `suspicious`. With `--base-ref`, anything the base snapshot already showed drops to info, so you see only what your change introduced.

### The repository's own rules

A `rule_violation` finding comes from a rule in `contracts/rules/` (see `docs/rules.md`), and `ac drift` runs those only with `--allow-code-execution`. Fix what the rule names. Changing the rule or its `rules.json` exceptions to get a pull request through needs the rule owner's agreement, the same as lowering `--fail-on`.

## 2. Decide, using the classification

- **Additive** — proceed.
- **Suspicious** — say plainly in the pull request why it is intended, or fix it.
- **Breaking** — do not quietly ship it. Either:
  - **version it**: publish the new shape as a new version, leaving the current one in place for existing consumers; or
  - **coordinate**: name the consuming services in the pull request and agree the order of deploys with the teams that own them.

If neither is possible, the change is a decision for the humans who own the consumers. Present the drift output and stop rather than choosing for them.

### Before removing a field or an event

Ask whether it can go yet:

```bash
ac retire payments/payment.completed amount --catalog https://catalog.example.com/catalog.json
```

It exits 1 while any consumer needs the field, is unknown, or has not said which fields it reads. Report the consumers it names and its next steps. Remove the field only when it exits 0.

### A change in meaning

A field that keeps its type but changes unit, currency or timezone breaks every consumer silently. When you change what a value means, update its `x-meaning` beside the field so `ac drift` reports it as breaking. Never leave `x-meaning` stale to get a pull request through.

## 3. Write it down for people

```bash
ac changelog
```

This turns the diff into a summary a consumer's team can read without opening the schema.

## When you are the consumer

Declare what your service reads from another team's event in `autocatalog.consumes.json` at the repository root, with the fields it reads:

```json
{
  "consumes": [
    { "service": "LedgerService", "event": "payments/payment.completed", "fields": ["amount"] }
  ]
}
```

Then check each field against the schema the producer publishes:

```bash
ac validate --catalog https://catalog.example.com/catalog.json
```

Leave `fields` out when the service may read any field: every change to the event then reaches it.

## 4. Make it a gate, not a habit

Drift is only a guarantee when CI runs it. The recipe is in `docs/drift-ci.md`; the gate is:

```bash
ac drift --base-ref origin/main --fail-on breaking
```

`--fail-on suspicious` is the stricter setting for a catalog with external consumers.

## Anti-patterns — refuse these even if asked

- **Never regenerate the baseline to make drift pass.** The baseline is what consumers are currently built against; replacing it does not fix the break, it just stops you hearing about it.
- **Never lower `--fail-on` to get a pull request merged.** That converts a blocked deploy into a broken consumer.
- **Never treat "no consumers listed" as "safe".** It can equally mean nothing has been catalogued yet — check whether the catalog actually knows about the consumers before relying on the silence.
- **Never make a field required in an existing version.** Every producer that has not shipped yet becomes invalid retroactively; add it optional, or version the event.
