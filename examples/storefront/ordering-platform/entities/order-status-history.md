---
name: Order Status History
summary: Audit history of order lifecycle state changes.
identifier: orderStatusHistoryId
properties:
  - name: orderStatusHistoryId
    type: UUID
    required: true
    description: Unique status history record.
  - name: orderId
    type: UUID
    required: true
    description: Order whose status changed.
    references: order
    referencesIdentifier: orderId
  - name: status
    type: string
    required: true
    description: New order status.
  - name: changedAt
    type: datetime
    required: true
    description: Time the status changed.
domains:
  - ordering
---

## Overview

Order Status History provides an audit trail for customer support, fulfilment exceptions and order lifecycle debugging.
