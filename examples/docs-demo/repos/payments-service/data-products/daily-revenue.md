---
name: Daily revenue
summary: What Acme captured each day, for finance to reconcile against settlement.
domain: payments
inputs:
  - event/payments/payment.captured
outputs:
  - { ref: service/LedgerService, contract: contracts/daily-revenue.schema.json }
---

Rebuilt every night from the day's captures. A late capture lands in the next day's figure.
