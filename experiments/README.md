# Acceptance experiments

Five claims, each tested the way a user would meet it: plain source trees are
copied to a temp directory, made into real git repositories (so commit SHAs and
dates are real), and the built CLI (`packages/events/cli/dist/bin.js`) runs on
them. Every check prints PASS or FAIL; the run exits non-zero on any FAIL.

```bash
pnpm experiments            # build, then run all five
pnpm experiment 03          # one experiment, all its variants
```

Adding a case is adding a folder:

- `repos/<repo>/` is a repository's final tree. `repos/<repo>/.history/<NN-message>/`
  holds whole earlier states, committed in order before the final tree.
- `02-breaking-change/prs/<name>/` (and `04-message-contracts/prs/<name>/`) is a pull request: files laid over the
  repository on a branch, plus `expect.json` (exit code, patterns the `github`
  and `markdown` output must and must not contain).
- `03-multi-repo/variants/<name>/` is a set of repositories plus `expect.json`
  (`extends`, `eventcatalog`, `quarantined`, `pages`, `links`, `absent`,
  `lastChanged`, `buildFails`).

`--eventcatalog` installs EventCatalog 4 from npm once into
`$TMPDIR/autocatalog-experiments-cache/eventcatalog`, so the first run needs the
network and later runs reuse it.

## 01 — A fresh repository reaches a useful site with minimal setup

**Run:** `pnpm experiment 01`. One repository, `shop`: a JSON Schema in
`contracts/` with a 6-line `x-autocatalog` block (id, version, domain,
producers, consumers) and a 9-line runbook in `docs/` that is `about:` the
event. JSON Schema rather than Zod because it is the passive default:
nothing to install, no `--allow-code-execution`, and `ac site` scans
`contracts/` on its own.

**Checks:** the quick-start path, `ac site .` on the untouched clone, with
`AUTOCATALOG_DOCS_LINKS=error`: event page and `schema.json`, both service
pages, the doc page and its listing on the event, `/catalog.json` resources,
`llms.txt`, no config file, and that the work tree holds only `dist/`, which the
command named. Then the optional scan (`ac .`): it writes only `events/`, says
so and whether to commit it, and `ac site .` builds from it without adding
anything else.

**Latest result: PASS.** 2 files, 27 lines, 0 config files, one command. Friction:

- Fixed: the quick-start led with `npx autocatalog .`, which a site does not
  need, and the scan left `events/` and an unasked `AGENTS.md` in the work tree
  without saying so. The scan now writes only `events/` and ends with what it
  wrote and whether to commit it.
- Service pages need `producers`/`consumers`; a bare schema gets an event page
  and nothing else.

## 02 — A breaking contract change produces an accurate, actionable CI failure

**Run:** `pnpm experiment 02`. `orders-service` on `main` has an event contract
with three consumers (BillingService declares it reads `total`,
ShippingService declares only `orderId`, AnalyticsService declares nothing) and
an `openapi.yaml`. Three PRs: `rename-total` (`total` → `amountDue` in both),
`rename-total-major` (the same rename, with both versions bumped to 2.0.0) and
`add-optional-field`. Each runs `ac drift --base-ref main --root . --format github`
and `--format markdown`, as `docs/drift-ci.md` recommends.

**Checks:** exit code; the rename is one error annotation on the line of the new
field, naming the field, the event and the file; the consumers split into "reads
it" (Billing), "fields undeclared or invalid" (Analytics) and "not affected"
(Shipping); the finding ends with the next step (keep `total` alongside
`amountDue`, or bump to 2.0.0 and notify Billing and Analytics); the OpenAPI
operation is named (`GET /orders/{orderId} (getOrder)`) on its line; the
"version stayed" warning asks for a major bump and never names Shipping; the
major-bump PR passes, still reporting both renames as acknowledged warnings
with who to notify; the markdown goes to `$GITHUB_STEP_SUMMARY`; the additive
PR passes and says nobody breaks.

**Latest result: PASS.** Accurate on field, event, operation, file, line and
consumers, and actionable: every breaking finding says how to land it, and the
major bump it suggests clears the severity gate. Earlier friction, now fixed:
no line numbers, a rename read as two breaking changes, "bump it" as the only
advice (and bumping did not clear the gate), and the "version stayed" warning
listing ShippingService as broken next to "not affected: ShippingService".

## 03 — Multiple repositories compose into a site with ownership, history, docs and diagrams

**Run:** `pnpm experiment 03`. Four variants of four or five repositories, built
with `ac site <root>`:

- `committed-catalogs` (built with `--eventcatalog`): handbook (docs plus a
  frontmatter contract), payments-service (committed `events/` going 1.0.0 →
  2.0.0 over two commits, with `versioned/1.0.0`), ledger-service (its own
  catalog, consumer docs `about:` a payments event), refund-agents (an agent
  consuming `payments/payment.captured`).
- `contracts-only`: handbook, orders-service (`contracts/` only, CODEOWNERS
  `@acme/orders`, contract 1.0.0 → 2.0.0 in git), shipping-service, support-agents.
- `one-broken-repo`: `committed-catalogs` plus legacy-service, whose event lost
  its `schema.json`.
- `docs-contract-violated`: `contracts-only` plus careless-service, whose document
  leaves out the `tier` the handbook's contract requires.

**Checks:** zero broken links; each repository's HEAD SHA in `catalog.json`;
the quarantine list is exact (named once in the build output, and on `/catalog`);
owner pages group docs, events and agents, with CODEOWNERS `acme/orders` and
a doc's `@acme/orders` landing on one page; the event version list, the
`/v/1.0.0/` page and the 1.0.0 → 2.0.0 diff, from committed `versioned/`
folders and from a contracts-only producer's git history; agents on event pages
linked to their `/catalog` entry; the handbook's docs contract failing the build
and naming the document; docs attached to event and service pages; "Linked from" backlinks across repositories; per-file git dates;
the Architecture page, and every event and service page linking to an
EventCatalog diagram that was built. Page checks assert on routes, link targets
and names rather than markup, so a redesign does not break them.

**Latest result: PASS** (40 checks across four variants; EventCatalog took about
a minute on the first run while it installed).

Gaps found, and fixed:

- A contracts-only producer's git history did not become version history:
  `/v/<version>/` pages came only from committed `versioned/` folders. Each
  earlier declared version in the last 50 commits to `contracts/` now does.
- The handbook's `contracts/docs-frontmatter.json` was not the site's contract.
  With none at the root, the site now enforces the one an enrolled repository
  publishes, and `ac site --docs-schema` names one.
- Agents listed on an event page had no link; they now link to their `/catalog`
  entry, as a document page does. There is still no agent page to land on.
- The quarantine warning was printed twice per build; it is printed once.

## 04 — autotel-message-contract approved files become gated catalog events

**Run:** `pnpm experiment 04`. `payments-service` has no schemas, only what
`autotel-message-contract` commits beside its tests, copied in its format
(sorted keys, two-space indent, no header, no trailing newline):
`src/payments/__contracts__/PaymentCaptured.approved.txt`, a sidecar declaring
id, version 2.0.0 and consumers (LedgerService reads `amount`, EmailService only
`orderId`), the pinned `PaymentCaptured_v1.approved.txt` kept for replay, and a
base64 protobuf `RefundIssued.approved.txt`, and a runbook in `docs/`. Two PRs re-approve the snapshot:
`rename-amount` (`amount` → `amountMinor`) and `add-field` (`method`).

**Checks:** `ac site .` on the untouched clone shows `payment.captured` with
its approved file, consumers and runbook, with no `ac scan` and no `events/`.
`ac .` catalogs `payment.captured` from the approved file at line 1
with the sidecar's version and consumers, the bytes as the example and the
schema marked `inferred`; the v1 file and the protobuf file are listed as
skipped, each with why. Then each PR through `ac drift --base-ref main`: the
rename is one error on the approved file naming LedgerService and not
EmailService, with the next step; the added field is a notice and passes.

**Latest result: PASS** (18 checks). Friction found, and fixed:

- `ac site` read only `contracts/`, so approved files beside their tests
  needed `ac scan` and a committed `events/`. Repository discovery now also
  finds `__contracts__/*.approved.txt` anywhere, and nothing else outside
  `contracts/`.

- Marking every field the sample showed as `required` made each added field
  "now required", a breaking error. One message shows a field present, not that
  every message carries it, so the inferred schema claims no `required`; a
  removal or rename still fails the gate.
- Findings land on line 1: drift maps a field to its line inside a JSON Schema,
  and an approved file is a sample, not a schema.

## 05 — autocatalog first, EventCatalog renders it, autotel proves it at runtime

**Run:** `pnpm experiment 05`. `orders-service` is TypeScript that calls
autotel's `track('order.placed', …)`; its `node --test` run records every event
with `ArchitectureSnapshotSubscriber` into `.autotel/snapshot.json`. It also has
`contracts/` (`order.placed` 1.0.0 → 1.1.0 in git, travelling on
`orders.events`, and `order.cancelled`, which no test emits), CODEOWNERS and a
runbook. `billing-service` consumes the event and documents it. autotel comes
from npm, pinned in the fixture's `package.json` (`autotel@8.0.0`,
`autotel-subscribers@59.0.3`, `autotel-eventcatalog@30.0.1`) and installed once
into `$TMPDIR/autocatalog-experiments-cache/autotel`. The pipeline, as run:

```bash
npm test                                      # writes .autotel/snapshot.json; committed
ac site <root> --eventcatalog                 # joins it, exports into the EventCatalog project
autotel-eventcatalog stamp --snapshot … --catalog <project>
ac site <root> --eventcatalog                 # exports again, builds EventCatalog
ac drift --base-ref HEAD --root . --snapshot .autotel/snapshot.json
autotel-eventcatalog drift --snapshot … --catalog <project> --fail-on-drift
```

`drift/orders-service/` is the same service after an unrecorded change: every
order gains `couponCode`, and a large one also emits `order.flagged`.

**Checks:** the snapshot holds what the tests did; the site's event page shows
the evidence (count, declared consumers BillingService and AnalyticsService,
only BillingService reported at runtime) beside both repositories' docs, with
no `ac scan` and no `events/`, and the 1.0.0 page from git history;
`order.cancelled` says no evidence is attached; the stamp lands in the exported
page, survives the next export byte for byte, and EventCatalog renders it.
After the drift, `ac drift --snapshot` reports `order.flagged` (undocumented),
`couponCode` on `order.placed` (undeclared) and `order.cancelled` (unseen) in
one report, passes by default and fails with `--fail-on suspicious`;
`autotel-eventcatalog drift` reports the same undocumented event and the same
field, and the same unseen event plus `invoice.issued`, because it reads the
whole catalog where `ac drift` reads one repository. Then
`autotel-eventcatalog generate` builds an EventCatalog from the same snapshot
without autocatalog, and the two projects are compared from their files:

| `order.placed`        | EventCatalog from the snapshot alone | From autocatalog                                    |
| --------------------- | ------------------------------------ | --------------------------------------------------- |
| Events                | `OrderPlaced`                        | `invoice.issued`, `order.cancelled`, `order.placed` |
| Id                    | `OrderPlaced`, from the code         | `order.placed`, as the contract says                |
| Version               | 1.0.0, assigned                      | 1.1.0, declared                                     |
| Earlier versions      | none                                 | 1.0.0, from git history                             |
| Required fields       | none                                 | `orderId`, `total`, `currency`                      |
| `currency`            | any string                           | `GBP` or `EUR`                                      |
| Owner                 | none                                 | `acme-orders`, from CODEOWNERS                      |
| Services receiving it | BillingService, reported at runtime  | AnalyticsService, BillingService, declared          |
| Channel               | `orders.events`                      | `orders.events`, declared                           |
| Docs                  | none                                 | runbook and consumer doc, on the site's event page  |

**Latest result: PASS** (23 checks; EventCatalog installs on the first run).
Found:

- Fixed: every export removed and rewrote the event page, so the next
  `ac site --eventcatalog`, `ac to-eventcatalog` or EventCatalog generator run
  deleted the block `stamp` had written. The export now keeps what sits between
  `<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->`.
- Fixed: field drift was autotel's alone, and `ac scan --snapshot` exited 0
  either way. `ac drift --snapshot` now gates on undocumented events and
  undeclared fields beside the contract changes.
- Fixed: carrying runtime evidence meant committing `events/`, which replaced
  `contracts/` and lost the 1.0.0 history. The site now joins
  `.autotel/snapshot.json` by convention, so contracts stay the source.
- Fixed: autocatalog exported no channels. Each transport address is now an
  EventCatalog channel. EventCatalog 4's build moves an event's `channels`
  onto its services' `sends[].to`, so the export writes them there.
