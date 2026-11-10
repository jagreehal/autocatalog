---
name: Search System
summary: Internal system that keeps product data searchable. Consumes product change events from the Product Catalog System, maintains a search index, and serves fast product search to the rest of the business.
owner: search-platform
---

## Overview

The **Search System** makes the catalog discoverable. It subscribes to product change events published by the [[system|product-catalog-system]], updates its **Search Index**, and exposes a search API so other teams can find products without ever touching the catalog database directly.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                   | Type       | Responsibility                                                        |
| --------------------------- | ---------- | --------------------------------------------------------------------- |
| [[service\|Search API]]     | Service    | Public-facing API. Serves product search queries from the index.      |
| [[service\|Search Indexer]] | Service    | Consumes product change events and keeps the search index up to date. |
| **Search Index**            | Data store | The index that powers product search.                                 |

## Messages this system consumes

The Search System reacts to product changes published by the Product Catalog System:

- [[event|product-platform/catalog/product-created]] — index the new product.
- [[event|product-platform/catalog/product-updated]] — re-index the changed product.
- [[event|product-platform/catalog/product-deleted]] — remove the product from the index.
