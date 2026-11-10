---
name: Warehouse Pick
summary: A warehouse task to pick items for a completed order.
identifier: pickId
properties:
  - name: pickId
    type: UUID
    required: true
    description: Unique warehouse pick identifier.
  - name: orderId
    type: UUID
    required: true
    description: Order being picked.
    references: order
    referencesIdentifier: orderId
  - name: assignedTo
    type: string
    required: false
    description: Warehouse worker or automation lane assigned.
  - name: status
    type: string
    required: true
    description: Pick task status.
domains:
  - fulfilment
---

## Overview

Warehouse Pick represents the operational task handled by the Warehouse System before an order can be packed and shipped.
