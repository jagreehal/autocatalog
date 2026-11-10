---
name: Search Indexer
summary: Consumes product change events from the Product Catalog System and keeps the search index up to date so products are discoverable.
owner: search-platform
---

## Overview

The **Search Indexer** is how the Search System stays in sync with the catalog. It subscribes to [[event|product-platform/catalog/product-created]], [[event|product-platform/catalog/product-updated]] and [[event|product-platform/catalog/product-deleted]] events published by the [[system|product-catalog-system]] and applies each change to the **Search Index**.

### Responsibilities

| Event                                               | Action                                       |
| --------------------------------------------------- | -------------------------------------------- |
| [[event\|product-platform/catalog/product-created]] | Add the new product to the **Search Index**. |
| [[event\|product-platform/catalog/product-updated]] | Re-index the changed product.                |
| [[event\|product-platform/catalog/product-deleted]] | Remove the product from the index.           |
