---
title: Product Search Indexing
summary: How a change to a product in the catalog reliably flows into the search index — via the outbox, product events and the indexer — so search stays in sync without coupling to the catalog database.
steps:
  - id: merchant_edits_product
    title: Merchant edits a product
    actor:
      name: Merchant
      summary: A merchant creates or updates a product in the catalog.
    next_step:
      id: product_api
      label: Apply change
  - id: product_api
    title: Product API
    service: Product API
    next_step:
      id: product_database
      label: Write change + outbox row
  - id: product_database
    title: Product Database
    custom:
      title: Product Database
    next_step:
      id: outbox_note
      label: Outbox row committed
  - id: outbox_note
    title: Outbox pattern
    custom:
      title: Transactional outbox
      summary: The product change and an outbox row are written in the same transaction, so the event can never be lost or out of sync with the data.
    next_step:
      id: product_search_publisher
      label: Drain outbox
  - id: product_search_publisher
    title: Product Search Publisher
    service: Product Search Publisher
    next_steps:
      - id: product_created
        label: Created
      - id: product_updated
        label: Updated
      - id: product_deleted
        label: Deleted
  - id: product_created
    title: Product Created
    event: catalog/product-created
    next_step:
      id: search_indexer
      label: Index product
  - id: product_updated
    title: Product Updated
    event: catalog/product-updated
    next_step:
      id: search_indexer
      label: Re-index product
  - id: product_deleted
    title: Product Deleted
    event: catalog/product-deleted
    next_step:
      id: search_indexer
      label: Remove from index
  - id: search_indexer
    title: Search Indexer
    service: Search Indexer
    next_step:
      id: search_index
      label: Apply to index
  - id: search_index
    title: Search Index
    custom:
      title: Search Index
    next_step:
      id: searchable
      label: Available to search
  - id: searchable
    title: Product is searchable
    custom:
      title: Product is searchable
      summary: The change is reflected in the search index and immediately available to customers via the Search API.
---

## Overview

**Product Search Indexing** documents how the [[system|search-system]] keeps its index in sync with the catalog. The search index is a derived read model — never a source of truth — so it can be rebuilt at any time by replaying product events.

## How it works

1. A merchant changes a product via the [[service|Product API]], which writes the change and an outbox row to the **Product Database** in one transaction.
2. The [[service|Product Search Publisher]] reliably drains the outbox and publishes [[event|product-platform/catalog/product-created]], [[event|product-platform/catalog/product-updated]] or [[event|product-platform/catalog/product-deleted]].
3. The [[service|Search Indexer]] consumes those events and applies them to the **Search Index**.
4. The change is now searchable via the Search API — with no direct coupling between search and the catalog database.
