---
name: Product
summary: The sellable item Acme manages in the product catalog.
identifier: productId
aggregateRoot: true
properties:
  - name: productId
    type: UUID
    required: true
    description: Unique product identifier.
  - name: sku
    type: string
    required: true
    description: Primary merchandising SKU.
  - name: name
    type: string
    required: true
    description: Customer-facing product name.
  - name: status
    type: string
    required: true
    description: Product publication state.
    enum:
      - draft
      - active
      - archived
domains:
  - catalog
---

## Overview

The Product is the Catalog domain's core aggregate. It is created and maintained by [[service|Product API]] and published to downstream consumers through product events.
