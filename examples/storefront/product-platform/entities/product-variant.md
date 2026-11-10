---
name: Product Variant
summary: A purchasable variation of a product, such as size or color.
identifier: variantId
properties:
  - name: variantId
    type: UUID
    required: true
    description: Unique variant identifier.
  - name: productId
    type: UUID
    required: true
    description: Product this variant belongs to.
    references: product
    referencesIdentifier: productId
  - name: sku
    type: string
    required: true
    description: Variant-level SKU.
  - name: attributes
    type: object
    required: true
    description: Variant dimensions such as size, color or material.
domains:
  - catalog
---

## Overview

Product Variant captures the concrete option a customer can buy. It belongs to a **Product** and is indexed into search when product data changes.
