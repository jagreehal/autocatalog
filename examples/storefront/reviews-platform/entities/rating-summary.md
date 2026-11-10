---
name: Rating Summary
summary: Aggregated review statistics for a product.
identifier: productId
properties:
  - name: productId
    type: UUID
    required: true
    description: Product being summarized.
    references: product
    referencesIdentifier: productId
  - name: averageRating
    type: decimal
    required: true
    description: Average published rating.
  - name: reviewCount
    type: integer
    required: true
    description: Number of published reviews.
  - name: updatedAt
    type: datetime
    required: true
    description: Time the summary was recalculated.
domains:
  - reviews
---

## Overview

Rating Summary is the read model maintained by [[service|Rating Aggregator]] and stored in **Rating Cache**.
