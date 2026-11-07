---
name: Payment
summary: Money a customer pays for one order, from authorisation to settlement.
aggregateRoot: true
identifier: paymentId
schema: contracts/payment.schema.json
domains: [payments]
services: [PaymentService]
lifecycles:
  status:
    states: [authorised, capturing, captured, failed, refunded]
    initial: authorised
    terminal: [failed, refunded]
---

A payment owns its refunds: a refund never exists without the payment it returns money from.
