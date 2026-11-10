---
name: Order Line
summary: A purchased product and quantity within an order.
identifier: orderLineId
properties:
  - name: orderLineId
    type: UUID
    required: true
    description: Unique order line identifier.
  - name: orderId
    type: UUID
    required: true
    description: Order this line belongs to.
    references: order
    referencesIdentifier: orderId
  - name: productId
    type: UUID
    required: true
    description: Product purchased.
    references: product
    referencesIdentifier: productId
  - name: quantity
    type: integer
    required: true
    description: Quantity purchased.
domains:
  - ordering
---

## Overview

Order Line snapshots the products bought at checkout. It should not replace the Catalog domain's authoritative product data.
