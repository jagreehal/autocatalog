---
name: Stock Item
summary: The inventory record for a product variant at a location.
identifier: stockItemId
aggregateRoot: true
properties:
  - name: stockItemId
    type: UUID
    required: true
    description: Unique stock item identifier.
  - name: productId
    type: UUID
    required: true
    description: Product held in stock.
    references: product
    referencesIdentifier: productId
  - name: locationId
    type: string
    required: true
    description: Warehouse or fulfilment location.
  - name: availableQuantity
    type: integer
    required: true
    description: Quantity available to reserve.
domains:
  - fulfilment
---

## Overview

Stock Item is the Inventory System's view of available stock for a product at a fulfilment location.
