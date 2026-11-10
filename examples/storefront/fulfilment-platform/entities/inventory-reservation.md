---
name: Inventory Reservation
summary: Stock held for a checkout or order before fulfilment.
identifier: reservationId
aggregateRoot: true
properties:
  - name: reservationId
    type: UUID
    required: true
    description: Unique reservation identifier.
  - name: orderId
    type: UUID
    required: false
    description: Order associated with the reservation once created.
    references: order
    referencesIdentifier: orderId
  - name: productId
    type: UUID
    required: true
    description: Product being reserved.
    references: product
    referencesIdentifier: productId
  - name: expiresAt
    type: datetime
    required: true
    description: Time the reservation expires if not committed.
domains:
  - fulfilment
---

## Overview

Inventory Reservation is created during checkout by [[event|ordering/reserve-inventory]] and released if the saga fails.
