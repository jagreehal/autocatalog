---
name: Cart
summary: The customer's active collection of items before an order exists.
identifier: cartId
aggregateRoot: true
properties:
  - name: cartId
    type: UUID
    required: true
    description: Unique cart identifier.
  - name: customerId
    type: UUID
    required: false
    description: Customer that owns the cart, if authenticated.
    references: customer-profile
    referencesIdentifier: customerId
  - name: status
    type: string
    required: true
    description: Current cart state.
    enum:
      - active
      - checked-out
      - abandoned
  - name: updatedAt
    type: datetime
    required: true
    description: Time the cart last changed.
domains:
  - shopping
---

## Overview

Cart is the Shopping domain aggregate. It accepts item changes and emits [[event|shopping-platform/shopping/cart-checked-out]] when the customer commits to buy.
