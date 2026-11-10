---
name: Moderation Decision
summary: The outcome of reviewing submitted customer feedback.
identifier: moderationDecisionId
properties:
  - name: moderationDecisionId
    type: UUID
    required: true
    description: Unique moderation decision identifier.
  - name: reviewId
    type: UUID
    required: true
    description: Review being moderated.
    references: review
    referencesIdentifier: reviewId
  - name: outcome
    type: string
    required: true
    description: Moderation result.
    enum:
      - published
      - rejected
  - name: decidedAt
    type: datetime
    required: true
    description: Time the decision was made.
domains:
  - reviews
---

## Overview

Moderation Decision records why a review became published or rejected and supports audit of [[service|Review Moderation Worker]] behavior.
