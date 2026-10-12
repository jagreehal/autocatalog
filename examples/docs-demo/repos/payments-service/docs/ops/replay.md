---
title: Replaying failed captures
owner: Payments
tier: critical
summary: The procedure, and the two preconditions that make it safe.
tags:
  - runbook
related:
  - payments-service/runbook
---

# Replaying failed captures

Replay resubmits captures that failed for a reason that has since been fixed.

## Preconditions

Both must hold. Replaying without them turns one incident into two.

- The original failure is fixed and confirmed fixed, not merely believed fixed.
- The replay window is inside the acquirer's idempotency window, which is 24
  hours. Older captures are re-authorised, not replayed, and re-authorisation
  needs a customer-facing decision.

## Procedure

```bash
payments replay --since <iso-timestamp> --dry-run
```

The dry run prints what would be submitted and the total value. Read the total
before continuing; an unexpectedly large number usually means the window is
wrong.

Then drop `--dry-run`. The command is idempotent per capture id, so a rerun
after a crash resubmits nothing that already succeeded.

## Afterwards

Reconciliation runs the next morning and is where a double capture would show
up. Nobody has to remember to check it, but somebody has to read it.
