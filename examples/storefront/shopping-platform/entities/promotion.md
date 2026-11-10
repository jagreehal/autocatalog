---
name: Promotion
summary: A commercial offer evaluated against a cart.
identifier: promotionId
aggregateRoot: true
properties:
  - name: promotionId
    type: UUID
    required: true
    description: Unique promotion identifier.
  - name: code
    type: string
    required: false
    description: Optional customer-entered promotion code.
  - name: categoryId
    type: UUID
    required: false
    description: Category the promotion applies to when scoped.
    references: category
    referencesIdentifier: categoryId
  - name: status
    type: string
    required: true
    description: Promotion lifecycle state.
  - name: startsAt
    type: datetime
    required: true
    description: When the promotion becomes active.
domains:
  - shopping
---

## Overview

Promotion is owned by the Promotion System and is evaluated when Shopping calculates discounts for a cart.
