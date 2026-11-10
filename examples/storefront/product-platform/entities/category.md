---
name: Category
summary: A merchandising grouping used to organize products for discovery.
identifier: categoryId
aggregateRoot: true
properties:
  - name: categoryId
    type: UUID
    required: true
    description: Unique category identifier.
  - name: slug
    type: string
    required: true
    description: Stable URL-safe category key.
  - name: displayName
    type: string
    required: true
    description: Customer-facing category name.
  - name: parentCategoryId
    type: UUID
    required: false
    description: Parent category for hierarchy navigation.
    references: category
    referencesIdentifier: categoryId
domains:
  - catalog
---

## Overview

Category defines how products are grouped for browsing. It is owned by the Catalog domain and projected into the Search System for discovery.
