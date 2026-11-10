---
name: Cart Item
summary: A product variant and quantity inside a cart.
identifier: cartItemId
properties:
  - name: cartItemId
    type: UUID
    required: true
    description: Unique cart item identifier.
  - name: cartId
    type: UUID
    required: true
    description: Cart this item belongs to.
    references: cart
    referencesIdentifier: cartId
  - name: productId
    type: UUID
    required: true
    description: Product selected by the customer.
    references: product
    referencesIdentifier: productId
  - name: quantity
    type: integer
    required: true
    description: Quantity requested.
domains:
  - shopping
---

## Overview

Cart Item records the customer's intent to buy a product variant before checkout. It is owned by **Cart**.
