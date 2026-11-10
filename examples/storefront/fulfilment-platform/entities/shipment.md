---
name: Shipment
summary: A carrier delivery for a packed customer order.
identifier: shipmentId
aggregateRoot: true
properties:
  - name: shipmentId
    type: UUID
    required: true
    description: Unique shipment identifier.
  - name: orderId
    type: UUID
    required: true
    description: Order being shipped.
    references: order
    referencesIdentifier: orderId
  - name: carrierReference
    type: string
    required: false
    description: External carrier tracking reference.
  - name: status
    type: string
    required: true
    description: Shipment delivery status.
domains:
  - fulfilment
---

## Overview

Shipment is created by the Shipping System and updated from carrier events such as [[event|fulfilment-platform/fulfilment/shipment-created]] and [[event|fulfilment-platform/fulfilment/shipment-delivered]].
