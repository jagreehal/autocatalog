---
name: Fraud Check
summary: Fraud screening result associated with a payment attempt.
identifier: fraudCheckId
properties:
  - name: fraudCheckId
    type: UUID
    required: true
    description: Unique fraud check identifier.
  - name: paymentId
    type: UUID
    required: true
    description: Payment attempt being screened.
    references: payment
    referencesIdentifier: paymentId
  - name: result
    type: string
    required: true
    description: Screening result.
    enum:
      - passed
      - failed
      - review
  - name: checkedAt
    type: datetime
    required: true
    description: Time screening completed.
domains:
  - payments
---

## Overview

Fraud Check documents the screening outcome from [[system|fraud-detection]] so payment decisions are auditable.
