---
name: Review Vote
summary: A customer's helpfulness vote on a product review.
identifier: voteId
properties:
  - name: voteId
    type: UUID
    required: true
    description: Unique review vote identifier.
  - name: reviewId
    type: UUID
    required: true
    description: Review being voted on.
    references: review
    referencesIdentifier: reviewId
  - name: customerId
    type: UUID
    required: true
    description: Customer who voted.
    references: customer-profile
    referencesIdentifier: customerId
  - name: votedAt
    type: datetime
    required: true
    description: Time the vote was submitted.
domains:
  - reviews
---

## Overview

Review Vote captures [[event|reviews/vote-review-helpful]] interactions and contributes to review helpfulness ranking.
