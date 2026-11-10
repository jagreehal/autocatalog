---
name: Payment
summary: Acme's internal record of payment intent and outcome for an order.
identifier: paymentId
aggregateRoot: true
properties:
  - name: paymentId
    type: UUID
    required: true
    description: Unique payment identifier.
  - name: orderId
    type: UUID
    required: true
    description: Order being paid for.
    references: order
    referencesIdentifier: orderId
  - name: amount
    type: decimal
    required: true
    description: Amount requested.
  - name: status
    type: string
    required: true
    description: Payment lifecycle status.
domains:
  - payments
---

## Overview

Payment is the Payments domain aggregate. It records Acme's view of payment state regardless of external provider retries or webhook order.
