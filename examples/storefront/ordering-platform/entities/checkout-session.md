---
name: Checkout Session
summary: The orchestration state for turning a checked-out cart into an order.
identifier: checkoutSessionId
aggregateRoot: true
properties:
  - name: checkoutSessionId
    type: UUID
    required: true
    description: Unique checkout session identifier.
  - name: cartId
    type: UUID
    required: true
    description: Cart being checked out.
    references: cart
    referencesIdentifier: cartId
  - name: status
    type: string
    required: true
    description: Current checkout state.
  - name: startedAt
    type: datetime
    required: true
    description: Time checkout orchestration started.
domains:
  - ordering
---

## Overview

Checkout Session tracks the saga managed by [[service|Checkout Orchestrator]] across inventory reservation, payment authorization and order creation.
