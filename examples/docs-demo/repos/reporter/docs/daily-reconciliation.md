---
title: Daily reconciliation report
owner: Data Platform
tier: standard
summary: What the morning report compares, and what a mismatch means.
tags:
  - runbook
related:
  - payments-service/ops/replay
---

# Daily reconciliation report

Runs at 06:00 UTC and compares the acquirer settlement file against captures
recorded by the payments service.

## Reading a mismatch

| Shape                        | Usual cause                                           |
| ---------------------------- | ----------------------------------------------------- |
| Settled, not captured by us  | A capture we lost. Investigate; do not replay.        |
| Captured by us, not settled  | Acquirer lag. Recheck the next day before escalating. |
| Two captures, one settlement | A replay outside the idempotency window.              |

The third shape is the expensive one, and it is why the replay procedure has
preconditions.

## When the report does not arrive

The report is a build artifact, not a service. If it is missing, the upstream
export failed and the settlement file is the source of truth until it is fixed.
Do not reconcile by hand against the dashboard, which is a projection and can be
stale.
