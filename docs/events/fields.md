---
title: Fields
owner: Maintainers
summary: Which events carry a field, which consumers it reaches, and where it disagrees with itself.
tags:
  - events
related:
  - docs/drift-ci
  - docs/events/validation
---

`ac fields` is a projection over the schemas already scanned — not a second
catalog to maintain. Every field found anywhere in the catalog is indexed by
its path, so you can ask the questions that only make sense across events.

```text
ac fields                    # every field, most-used first
ac fields customerId         # who carries it, who reads it
ac fields --conflicts-only   # where the same field disagrees with itself
ac fields --json             # the index, for whatever asks next
```

Browse the same index at **`/fields`** on the site `ac site` builds. Filter by
field, event or service, or show only the fields that disagree. Each row names
the events that carry the field and the services a change would reach.

## What a field lookup answers

```text
$ ac fields customerId

customerId  string
  payments/payment.completed@1.0.0  string  required
  payments/payment.refunded@1.2.0   string  optional
  orders/order.placed@2.0.0         number  required
  ⚠ types differ: number | string; required in 2/3

  reaches: LedgerService, NotificationService, FulfilmentService  (via those events)
```

Nested objects and array elements get honest paths: `payment.amount`,
`items[].sku`.

## What "reaches" means

Consumers are inferred from the events a service already consumes: if a service
receives `payment.completed`, it can see every field that event carries. Nobody
declares which fields they read.

That is deliberate. A per-field `reads:` list would be hand-maintained metadata
that rots the moment someone refactors — the exact failure this tool exists to
avoid. So `reaches` over-estimates the blast radius rather than confidently
under-reporting it: everyone listed _could_ break, and no one who could break is
missing.

## Conflicts are the point

Two events using `customerId` as a `string` in one place and a `number` in
another is a real defect that no single-event validation can see. Same for a
field that is guaranteed in one event and optional in another — consumers
cannot safely assume presence, but nothing in either schema says so.

`--conflicts-only` exits 0 either way; it is a report, not a gate. The gate is
[`ac drift`](/docs/drift-ci), which fails the PR when a field that consumers
depend on changes.
