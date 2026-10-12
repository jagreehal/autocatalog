---
title: How captures reach the ledger
owner: Finance Platform
tier: standard
summary: The ledger reads payment.captured and posts one entry per capture.
related:
  - payments-service/runbook
about:
  - event/payments/payment.captured
  - service/LedgerService
---

The ledger reads `paymentId` and `amount.value` from each capture and
publishes `ledger.entry.posted`.
