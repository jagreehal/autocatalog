---
name: Review Flag
summary: A customer report that a review may violate policy.
identifier: flagId
properties:
  - name: flagId
    type: UUID
    required: true
    description: Unique review flag identifier.
  - name: reviewId
    type: UUID
    required: true
    description: Review being reported.
    references: review
    referencesIdentifier: reviewId
  - name: reason
    type: string
    required: true
    description: Reason selected by the customer.
  - name: flaggedAt
    type: datetime
    required: true
    description: Time the review was flagged.
domains:
  - reviews
---

## Overview

Review Flag captures [[event|reviews/flag-review]] interactions and can send a published review back through moderation.
