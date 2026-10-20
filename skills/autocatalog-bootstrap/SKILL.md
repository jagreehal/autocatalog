---
name: autocatalog-bootstrap
description: Stand up a catalog on a repository that has never had one — scan, then work the gaps by fixing the source until the catalog is true. Use when the user points at an existing codebase and asks to get started, adopt autocatalog, bootstrap a catalog, or when a first scan left a pile of entries needing review.
---

# /autocatalog-bootstrap

The job is to make the **repository** describe its events well enough that a scan
is correct. It is not to write a catalog.

If you ever find yourself typing event definitions into a file the scanner
generates, stop — you are building the thing this tool exists to replace.

## 1. See what the repo already says

```bash
ac scan . --out ./events
```

Read the summary it prints: how many events, how many `needsReview`, which
adapter found what. That number is the starting position, not a score.

Nothing found? Check which formats are actually present before concluding the
repo has no events — the scan reads JSON Schema, OpenAPI (`webhooks`,
`callbacks`, and operations marked `x-autocatalog`), Avro `.avsc`, and protobuf
`.proto` with no configuration. Zod and other runtime adapters need
`ac scan . --allow-code-execution`, which runs repository code, so only for
source you have read and trust. A company format needs an adapter of its own:
see `docs/adapters.md`.

No contracts at all, but the tests record an autotel snapshot? Start from what
ran:

```bash
ac from-snapshot .autotel/snapshot.json --out ./events
```

Each event it writes is a draft marked for review. Move each contract into the
code that sends it, then `ac scan` finds it from then on.

## 2. Work the gaps, hardest first

Three questions, in this order. Each has a command that answers it.

**Which entries is the scanner unsure about?**

```bash
ac health --min 60
```

Anything `needsReview` or low-confidence is the tool admitting it guessed. Open
the `source` file and line each one points at and confirm against the code.

**Which fields disagree with themselves across events?**

```bash
ac fields --conflicts-only
```

The same field typed `string` in one event and `number` in another is a real
defect the repo has been carrying silently. Fix the schemas, not the report.

**Does anything still fail outright?**

```bash
ac validate
```

## 3. Fix the source, never the output

For each gap, in order of preference:

1. **Make it explicit where it is defined.** An `x-autocatalog` block on the
   OpenAPI operation, `option (autocatalog.id)` on the protobuf message,
   `x-autocatalog` in the Avro schema, a `defineEvent()` id in TypeScript. The
   next scan is then certain, for everyone, forever.
2. **Put ownership in CODEOWNERS**, where it already belongs, instead of typing
   a team name into a manifest.
3. **Only then** hand-author a manifest, for something genuinely not expressible
   at the source — and say in the pull request why.

Re-run `ac scan` after each fix. The number of reviewed entries should fall
because the source got clearer, never because someone edited the output.

## 4. Leave the gate behind you

A catalog nobody checks drifts back to fiction within a quarter. Before
finishing, wire the CI gate:

```bash
ac drift --base-ref origin/main --root . --format github
```

See `docs/drift-ci.md` for the workflow file. Teams who reason in Schema
Registry terms can gate with `ac drift --base-ref origin/main --compatibility backward`
instead of the severity model.

## Anti-patterns — refuse these even if asked

- **Never write event definitions into the generated catalog** to make a repo
  look documented. A catalog that describes events the code does not emit is
  worse than no catalog, because people believe it.
- **Never hand-edit a generated `autocatalog.json`** to clear a gap. Fix what
  produced it.
- **Never remove `needsReview` or raise `confidence` by hand.** They are the
  tool's honesty about its own guesses.
- **Never interview the user for event names and write them down.** Ask where
  the events are _defined_, then point the scanner at that.
- **Never pass `--allow-code-execution` on source you have not read.**
