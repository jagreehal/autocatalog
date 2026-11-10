---
name: Refund
summary: A request to return money to a customer after payment.
identifier: refundId
aggregateRoot: true
properties:
  - name: refundId
    type: UUID
    required: true
    description: Unique refund identifier.
  - name: paymentId
    type: UUID
    required: true
    description: Payment being refunded.
    references: payment
    referencesIdentifier: paymentId
  - name: amount
    type: decimal
    required: true
    description: Refund amount.
  - name: status
    type: string
    required: true
    description: Refund lifecycle state.
domains:
  - payments
---

## Overview

Refund is owned by Payments and records refund requests and provider outcomes such as [[event|payments-platform/payments/refund-processed]].
