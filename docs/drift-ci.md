---
title: Drift gating in CI
owner: Maintainers
summary: Fail the pull request that breaks a consumer, not the release that ships it.
tags:
  - ci
related:
  - docs/events/versioning
  - docs/production
---

`ac drift` compares two generated catalogs and fails when a change breaks a
consumer. The baseline is the catalog extracted from your default branch; the
current is the one extracted from the PR. Because both sides are generated
from source, the gate catches breaks the moment the code changes — no one has
to remember to update a spec.

## GitHub Actions

```yaml
name: contract-drift
on: pull_request

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile

      - run: git fetch origin main

      # Scans origin/main and the PR through the same adapters, then compares.
      # Exits 1 on breaking changes and names the consumers they break.
      # Add --allow-code-execution only on a locked-down runner when runtime
      # adapters (for example Zod) or catalog rules (docs/rules) are required
      # and PR code is trusted.
      # Optional: gate on Schema Registry compatibility instead of severity
      # - run: pnpm exec ac drift --base-ref origin/main --root . --format github --compatibility backward
      - run: pnpm exec ac drift --base-ref origin/main --root . --format github
```

`--format github` is the CI format. It emits GitHub workflow commands, so every
finding becomes an annotation on the pull request: breaking changes are errors,
suspicious ones warnings, additive ones notices. Findings the scanner traced
back to code annotate that file and line, so the review lands on the Zod schema
that changed rather than in a job log nobody opens. Findings on a JSON Schema
contract or an OpenAPI document (JSON or YAML) land on the line of the field
that changed; a field that was removed lands on the object that held it. The
same report is appended to the job summary as markdown.

A rename to `amountDue` in `contracts/order-placed.json` reads like this:

```text
::error file=contracts/order-placed.json,line=10,title=orders/order.placed::field `total` (number) looks renamed to `amountDue` — breaks BillingService, AnalyticsService (reads it: BillingService; fields undeclared or invalid: AnalyticsService; not affected: ShippingService). Next: keep `total` alongside `amountDue` until consumers move off it, or bump to 2.0.0 to mark it intentional and notify BillingService, AnalyticsService
```

There is no action to install — this is `npx` plus five lines of YAML, and no
API key. If you want the report elsewhere, `--format json` is the machine
format: pipe it to whatever already posts to your chat tool.

## Severity model

| Change                            | Severity   | Rationale                                |
| --------------------------------- | ---------- | ---------------------------------------- |
| Event removed                     | breaking   | every consumer loses the contract        |
| Field removed                     | breaking   | consumers reading it get `undefined`     |
| Field renamed                     | breaking   | the same, under a name nobody reads yet  |
| Field type changed                | breaking   | parsers on both sides disagree           |
| Field becomes required            | breaking   | payloads that omit it become invalid     |
| Field meaning changed             | breaking   | it parses, and every reader misreads it  |
| Enum narrowed                     | breaking   | already-published values become invalid  |
| Delivery promise changed/removed  | breaking   | consumers built on it, as on a field     |
| Maximum lateness lengthened       | breaking   | consumers stop waiting too soon          |
| New access to another team's data | breaking   | it couples one team to another's storage |
| Field no longer required          | suspicious | consumers relying on presence may break  |
| Format changed                    | suspicious | semantic change without a structural one |
| Field meaning no longer declared  | suspicious | readers lose the assumption they read by |
| Schema changed, version unchanged | suspicious | version discipline is the whole point    |
| New optional field / widened enum | additive   | safe                                     |
| New delivery promise              | additive   | nobody relied on it yet                  |
| Maximum lateness shortened        | additive   | the longer window still holds            |
| New event                         | additive   | safe                                     |

`--fail-on suspicious` tightens the gate; `--fail-on never` turns it into a
report (useful while adopting).

Nested fields are compared too — a type change on `payment.amount` or
`items[].sku` is reported at that path, with the same severity rules. A removed
object is one finding, not one per field underneath it.

A rename is one finding too, not a removal plus a new required field. The rule
is deliberately narrow: exactly one field removed and one added under the same
parent, with the same type. Anything looser is a guess, and a wrong guess hides
a removal, so two fields moving at once, or a rename that also changes the
type, are reported as the separate changes they are.

### Changes in meaning

A schema says `amount` is a number. It cannot say the number is pence, not
pounds, so no schema diff sees the day it switches. Declare what a field means
beside it, under `x-meaning`:

```json
{
  "amount": {
    "type": "number",
    "x-meaning": { "unit": "pence", "currency": "GBP" }
  },
  "placedAt": {
    "type": "string",
    "format": "date-time",
    "x-meaning": { "timezone": "UTC" }
  }
}
```

Any key works, with a text value. `unit`, `currency`, `timezone`, `identifier` (what the value
identifies) and `ordering` cover most fields. `ac drift` compares them field by
field: a changed value is breaking and names the consumers that read the field,
a dropped one is suspicious, and declaring one for the first time is info. A
registry accepts all three, so no `--compatibility` strategy fails on them. In
Zod, `z.number().meta({ 'x-meaning': { unit: 'pence' } })` carries through to
the schema. A [catalog rule](/docs/rules) can require the declaration, for
example on every field named `amount`.

The "version stayed" warning names the consumers the changes reach, and nobody
else: a consumer that declared it does not read the changed field is not told a
version number breaks it.

A changed delivery guarantee, ordering key or idempotency key, or a longer
maximum lateness, is acknowledged by a major version like any other breaking
change. It does not fail a
`--compatibility` gate, since the payload a registry checks is unchanged.

### Another team's datastore

A service that starts reading or writing a table or collection that another
team owns fails the change that introduced it:

```text
checkout (payments) reads collection acme/finance/statements, which ledger owns
```

Owners come from the same places as everywhere else: `catalog-info.yaml`,
imports and CODEOWNERS (see [brownfield resources](/docs/brownfield-resources)).
Access is seen in code, or in traces given to `ac resources scan --traces`.
Only new access is reported, so adopting this does not fail on what is already
there, and nothing is said when either owner is unknown. A deliberate exception, such as a
migration, is reviewed with `ac resources promote`; it is then reported as a
warning that does not fail `--fail-on breaking`.

## Consumers in other repositories

An event's manifest lists the consumers its producer knows about. A team in
another repository can start reading the event without telling anyone, and the
producer's pull request would never name it. That team declares what it
consumes in its own repository, in `autocatalog.consumes.json` at the root:

```json
{
  "consumes": [
    {
      "service": "LedgerService",
      "event": "payments/payment.completed",
      "fields": ["amount", "currency"]
    }
  ]
}
```

`ac site` joins every repository's declarations into the company graph it
publishes at `/catalog.json`. A declaration naming an event no repository
publishes, or one two repositories publish, keeps that repository out of the
graph and the build says why. The event's page lists the declared consumers
beside the ones its manifest names.

Any repository can name any service, so a declaration only adds consumers. It
never narrows one the producer's manifest lists: for those, the producer's
`consumerFields` decide what they read. Two declarations of one consumer
combine their fields, and one that names no fields, or a field path that is not
one, means the consumer may read anything. A consumer that may read anything is
reached by every change.

Names from these files, and from runtime snapshots, reach terminal output,
Markdown and pull request annotations, so they keep to letters, digits, spaces
and `. _ : / -`. A declaration with any other name fails `ac validate`. Drift
still counts such a consumer, as "a consumer whose name is not safe to print",
so a hostile name cannot make the gate pass, and it prints the name escaped.

The producer's pull request reads them back:

```bash
ac drift --base-ref origin/main --root . --consumers https://catalog.acme.dev/catalog.json
```

A renamed `amount` then fails with `breaks LedgerService`. A consumer that
declared it reads only `currency` is listed as not affected. For a private site,
`--consumers-token-env CATALOG_TOKEN` sends the token from that variable.
`--consumers` also takes a file, such as a `catalog.json` your pipeline
downloaded. When two repositories publish the same event, drift counts the consumers of
this repository's copy, naming it from the `origin` remote or `--repository`.
When it cannot tell which copy is its own, it counts the consumers of every
copy and says so.

The site is built from each repository's main branch, so a consumer declared in
an open pull request counts once it merges and the site rebuilds. Drift prints
when the index it read was published, from the site's `Last-Modified` header or
the file's time, and how long ago:

````text
  consumers from https://catalog.acme.dev/catalog.json, published 2026-10-12T21:30:00Z (2 hour(s) ago)
``` If the index
cannot be read, drift says so and runs without it: an outage on the site does
not block pull requests across the company.

The consumer checks its side too. In the consumer's own pull request,
`ac validate --catalog <url>` checks each declared event exists and each field
it reads is in the schema the producer publishes, so a typo such as `amout`
fails before anyone relies on it.

## Landing a breaking change

Every breaking finding ends with what to do next. There are two ways through
the gate:

- **Make it compatible.** Keep `total` alongside `amountDue` until consumers
  have moved, keep a removed field and mark it deprecated, make a new required
  field optional until every sender includes it. Then remove the old shape in a
  later change, when nobody reads it.
- **Acknowledge it with a major version.** Bump the event's `version` to the
  next major (`1.4.0` → `2.0.0`, or `V1` → `V2` for EventCatalog-style
  versions). A breaking change that comes with a major bump is still reported,
  with the consumers to notify, but as a warning that does not fail
  `--fail-on breaking`. For an OpenAPI document the version is `info.version`.

A minor or patch bump does not acknowledge anything, and the finding says so:
`or bump to 2.0.0 (1.1.0 is not a major bump)`. Removing an event outright has
no version left to bump, so it always fails; deprecate it first and remove it
when its consumers have moved.

Acknowledging applies to the severity gate only. A `--compatibility` gate is a
Schema Registry promise about which side may upgrade first, and a version
number does not change whether an old reader can parse new data — so an
acknowledged change still fails the strategy it violates.

## Runtime drift

The contracts say what a service promises; a runtime snapshot says what it
actually sent. `--snapshot` checks the current catalog against one, in the same
command, report, formats and gates:

```yaml
- run: npm test # autotel's ArchitectureSnapshotSubscriber writes .autotel/snapshot.json
- run: pnpm exec ac drift --base-ref origin/main --root . --format github --snapshot .autotel/snapshot.json
````

It reads the `autotel-architecture/*` snapshot autotel's
`ArchitectureSnapshotSubscriber` writes, and works with `--base-ref` and with
`--base`/`--current` alike. A file that is not a snapshot fails the command
before anything is scanned: read as empty, it would report every event unseen.

The consumers a snapshot records join each finding's list, after the declared
ones and labelled with how the snapshot knows: `FraudService (seen at runtime)`
when it saw the delivery, `(reported at runtime)` when message metadata named
it. A consumer already declared is named once, as declared.

| Runtime finding                         | Severity   | Rationale                                                                                    |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Field sent as a type the schema forbids | breaking   | the payload breaks the contract consumers trusted: `amount` as a string where it is a number |
| Value outside the schema's enum         | breaking   | a consumer handling only the declared values meets one it does not know                      |
| Event emitted, not in the catalog       | suspicious | an undocumented contract: consumers can come to depend on it with nobody reviewing it        |
| Field observed, not in the schema       | suspicious | the same, one field at a time; names the field and the event, lands on the contract          |
| Producer or channel the event omits     | suspicious | something sends the event, or sends it somewhere, that its page does not say                 |
| Producer or channel, none declared      | info       | the event names none; declare what the runtime saw                                           |
| Event documented, never seen            | info       | one test run or traffic window is not proof the event is gone                                |

The two breaking findings are payloads the contract says cannot happen, so they
fail the default gate and name the event's consumers. A key set to `undefined`
never reaches the wire and is not a type. JavaScript has no integer, so an
`integer` field fails on a fractional sample value, not on `number`, and a
`Date` sent to a string field with a `format` counts as the string it becomes.
The report counts rejected values and never prints them. A field
declared differently in each branch of a `oneOf` is not checked: no one branch
is its contract. The rest gate with `--fail-on suspicious`. None is a schema
change, so no compatibility strategy fails on them.

Event names ignore case and `.`, `_`, `-`, so `track('order.placed')` is the
catalog's `OrderPlaced`. An exact name wins over
a loose one, and a loose name that fits two events is refused rather than
guessed. When an event that ran undocumented and one documented but unseen have
similar names, both findings say it could be a rename: `` `payment.refund` is
probably `payment.refunded` renamed (87% similar) ``. Both stay reported, since
on the day it is not a rename one of them is a real removal.

A declared field the snapshot never carried is not reported: an optional field
absent from one run says nothing.

### Only what the change introduced

A gap the default branch already has would otherwise fail every pull request
until someone fixes it, and that is how a gate gets switched off. With
`--base-ref`, drift reads the snapshot as the base committed it, at the same
path, and checks the base catalog against it too. A runtime finding already
true on the base is still reported, as `info` and saying so, and does not fail
the change. Commit the snapshot for this to work; without one at the base,
every runtime finding counts. Name another file with `--base-snapshot <file>`,
which also works with `--base`/`--current`.

After the change in [experiment 05](https://github.com/jagreehal/autocatalog/tree/main/experiments),
where every order gains `couponCode` and a large one also emits
`order.flagged`, `--format markdown` reads:

```markdown
# Contract drift

**0 breaking** · 2 suspicious · 0 additive

## order.flagged

- ⚠ suspicious: the runtime emitted this event 1 time(s) from OrderService, but the catalog does not document it — an undocumented contract consumers can come to depend on unreviewed. Declare a contract for it, or stop emitting it

## orders/order.placed

- ⚠ suspicious: runtime payloads carry `couponCode`, which the schema does not declare — consumers can start reading it with no contract behind it. Declare it, or stop sending it

## orders/order.cancelled

- ℹ info: documented, but not observed in the runtime snapshot (snapshot of 2026-10-10T05:22:17.032Z); one window is not proof it is gone
```

## Compatibility strategies

Teams who already reason in Schema Registry terms can gate on a strategy
instead of severity:

```bash
ac drift --base-ref origin/main --compatibility backward
```

`backward` means the new schema reads old data (consumers upgrade first);
`forward` means the old schema reads new data (producers upgrade first); `full`
is both; `none` disables the gate. Passing `--compatibility` replaces the
severity gate rather than stacking with it — they answer different questions.

With `--base-ref`, the OpenAPI documents a repository publishes are compared per
operation too, and the same modes are read in API terms: `backward` means the new
API still serves existing clients, `forward` that new clients still work against
the old API. A request is read by the server and a response by the client, so a
response change that old readers cannot parse — a new enum value, say — fails
`backward`.

Whether a change is compatible usually depends on the object it happens in, so
the rows below say which condition decides. "Open" means the object accepts
properties it does not name; "restricted" means `additionalProperties` is
`false` or a schema that constrains them.

| Change                                                                                                  | BACKWARD | FORWARD |
| ------------------------------------------------------------------------------------------------------- | -------- | ------- |
| Add optional field, object open                                                                         | ✖        | ok      |
| Add optional field, object restricted                                                                   | ✖        | ✖       |
| Add required field                                                                                      | ✖        | ok      |
| Add a field forbidden by `false`                                                                        | ✖        | ok      |
| Remove optional field, object open                                                                      | ok       | ✖       |
| Remove optional field, object closed                                                                    | ok       | ok      |
| Remove required field                                                                                   | ok       | ✖       |
| Field becomes required                                                                                  | ✖        | ok      |
| Field becomes optional                                                                                  | ok       | ✖       |
| Type or format changed                                                                                  | ✖        | ✖       |
| Constraint tightened (`minimum`, `maxLength`, `items`, …)                                               | ✖        | ok      |
| Constraint loosened                                                                                     | ok       | ✖       |
| Constraint changed ambiguously (`pattern`, `oneOf`, `not`, a conditional predicate, unmodelled keyword) | ✖        | ✖       |
| Enum values removed, or an enum introduced                                                              | ✖        | ok      |
| Enum values added, or an enum dropped                                                                   | ok       | ✖       |
| Event removed                                                                                           | ✖        | ✖       |

Two rows are worth reading twice, because both once said "ok" here and a
validator disagreed.

**Adding an optional field is not free.** If the object was open, that name
already accepted any value, and typing it rejects payloads that carried
something else — so BACKWARD fails. If the object was restricted, the new field
also lets through values the old schema refused, so FORWARD fails too. The
severity model still calls this `additive`, on purpose: adding a field is the
commonest change there is, and failing the default gate on it is how a gate
gets turned off.

**Some changes are reported because they cannot be cleared, not because they
break.** A rewritten `pattern`, an edit inside `oneOf` or `not`, a changed
conditional predicate, or any keyword this tool does not model are all reported
as breaking: each _can_ reject payloads that were accepted, and deciding which
would take a solver. Two conditional cases are proven safe instead of assumed
unsafe — a predicate whose `then`/`else` impose no constraints, and one whose
branches are identical — because there the predicate cannot change what is
accepted. For the rest, `--compatibility none` or a narrower gate is the escape
hatch.

**Removing an optional field is not free either.** Dropping the definition stops
constraining the name, so a new producer may send it as anything and a reader
built from the old schema rejects that — FORWARD fails. It only stays compatible
when the object is closed, which stops the field appearing at all.

These are the registry's rules, not the severity model above, and the two
disagree on purpose. Removing an optional field is `breaking` here — a consumer
reading it now gets `undefined` — yet gated only under FORWARD. A team asking for
BACKWARD gets BACKWARD.

If CI already produces immutable Catalog artifacts, directory mode remains
available: `ac drift --base /tmp/baseline-events --current /tmp/current-events`.
It has no source tree to read, so JSON Schema findings there annotate the file
without a line. Each artifact's `resources.json`, written by `ac scan --out`
when the repository has [datastore or command resources](./brownfield-resources.md),
is compared as well; if only one artifact has it, drift warns and compares no
resources.

Every breaking finding names the consumers it breaks, read from the event's
`consumers` metadata — so the PR author sees "breaks LedgerService,
NotificationService", not just a schema diff.
