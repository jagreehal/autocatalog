---
name: Discount
summary: The calculated benefit applied to a cart or cart item.
identifier: discountId
properties:
  - name: discountId
    type: UUID
    required: true
    description: Unique discount identifier.
  - name: promotionId
    type: UUID
    required: false
    description: Promotion that produced the discount.
    references: promotion
    referencesIdentifier: promotionId
  - name: amount
    type: decimal
    required: true
    description: Monetary value of the discount.
  - name: reason
    type: string
    required: true
    description: Human-readable explanation for the discount.
domains:
  - shopping
---

## Overview

Discount is a calculated result from [[event|shopping/calculate-discount]]. It is separate from cart persistence so promotion logic can evolve independently.
