---
title: Payments runbook
owner: '@acme/payments'
summary: What to do when captures stop reaching the ledger.
about:
  - event/payments/payment.captured
---

If the ledger stops booking captures, check that `PaymentService` still emits
`payment.captured` with the shape its approved contract pins.
