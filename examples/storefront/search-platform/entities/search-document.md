---
name: Search Document
summary: The denormalized representation of product data indexed by Search.
identifier: documentId
properties:
  - name: documentId
    type: string
    required: true
    description: Search index document identifier.
  - name: productId
    type: UUID
    required: true
    description: Product represented by the document.
    references: product
    referencesIdentifier: productId
  - name: searchableText
    type: string
    required: true
    description: Text used for matching and ranking.
  - name: indexedAt
    type: datetime
    required: true
    description: Time the document was last indexed.
domains:
  - catalog
---

## Overview

Search Document is the read model maintained by [[system|search-system]]. It is eventually consistent with the Product Catalog System.
