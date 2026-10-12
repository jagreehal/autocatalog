---
title: Payments runbook
owner: Payments
tier: critical
summary: What to do when captures fail.
related:
  - handbook/incident-policy
about:
  - event/payments/payment.captured
  - service/PaymentService
---

Version 2 sends `amount` as integer minor units with a currency. A consumer
still parsing a decimal `amount` is reading version 1.
