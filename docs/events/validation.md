---
title: Validation
owner: Maintainers
summary: What `ac validate` and `ac health` check, and how to make them fail a build.
tags:
  - events
  - ci
related:
  - docs/drift-ci
  - docs/cli
---

```bash
ac validate
```

Checks:

- Every event has an `autocatalog.json` manifest matching the catalog schema
- Every `schema.json` is valid JSON Schema 2020-12
- Every example file validates against its own schema, except those under
  `examples/invalid/`, which must fail it
- A `duplicate` example repeats another example's idempotency key (a warning)
- Every `delivery` key is a field the schema has, in every valid payload
- No duplicate `(domain, id, version)` combinations
- `deprecation.replacedBy` references resolve to an event that exists
- Versioned entry ids match their parent
- The spec version is `autocatalog/v2`

A version that is neither semver (`1.2.3`, `v1.2.3`) nor an integer
(`2`, `V2`, as EventCatalog writes them) is a warning, not a failure. Promote
warnings in CI:

```bash
ac validate --strict-warnings
```

## Project rules

Naming and completeness rules live in `contracts/event-manifest.json`, beside
the [docs frontmatter contract](/docs/docs-convention#the-contract-is-yours).
It is a JSON Schema every `autocatalog.json` must also satisfy, found without a
flag; without the file, only the catalog schema applies.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "required": ["owner", "classification"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z]+(\\.[a-z]+)+$" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
  }
}
```

Each event that breaks it is a `policy_violation` error naming the failing
field, so `ac validate` fails the merge. Defaults are already applied when the
contract runs: require a non-empty list with `minItems`, not `required`.

## Example cases

An example in a folder named for an edge case shows that case:

```text
examples/
  placed.json                  the happy path
  empty/no-lines.json          nothing to report, still valid
  partial/no-address.json      only the fields that are always there
  duplicate/redelivered.json   a repeat consumers must recognise
  late/after-outage.json       arrives after events that happened after it
  invalid/no-total.json        a message consumers must reject
```

The site labels each one and says what it shows. Give one a better name or
summary in `examples/examples.config.yaml`, the file EventCatalog reads:

```yaml
duplicate/redelivered.json:
  name: Redelivered after a timeout
  summary: The broker gave up waiting for an acknowledgement and sent it again.
```

A rescan never deletes a case folder, so the ones you write by hand stay.

## Scoring what is merely valid

Validation answers "is this well-formed". `ac health` answers "is this any good":

```bash
ac health --min 70
```

Each event is scored on completeness, ownership, examples, versioning, edge
cases and correlation, and the command exits non-zero if any event falls below
`--min`. An at-least-once event is asked for a `duplicate` example in
particular, since its consumers will see one. Start with a
threshold your catalog already passes and raise it as you fill gaps, rather than
merging a red build on day one.

## In CI

```yaml
- run: pnpm exec ac validate --strict-warnings
- run: pnpm exec ac health --min 70
```

Validation catches a broken catalog. It does not catch a valid catalog that
quietly breaks a consumer — that is what [drift gating](/docs/drift-ci) is for,
and the two run together.
