---
name: Product Catalog System
summary: Internal system that is the source of truth for product data. Owns the product database and publishes product change events for the rest of the business to consume.
owner: product-platform
---

## Overview

The **Product Catalog System** is the system of record for products at Acme Inc. It accepts commands to create, update and delete products, persists them in the **Product Database**, and emits domain events whenever product data changes so downstream systems — like the [[system|search-system]] — can react.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                             | Type       | Responsibility                                                              |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| [[service\|Product API]]              | Service    | Public-facing API. Handles create/update/delete commands and product reads. |
| [[service\|Product Worker]]           | Service    | Processes long-running and asynchronous catalog work off the request path.  |
| [[service\|Product Search Publisher]] | Service    | Publishes product change events for the Search System to consume.           |
| **Product Database**                  | Data store | PostgreSQL system of record for all product data.                           |

## Messages this system publishes

When product data changes, the system emits these events:

- [[event|product-platform/catalog/product-created]] — a new product has been added to the catalog.
- [[event|product-platform/catalog/product-updated]] — an existing product's data has changed.
- [[event|product-platform/catalog/product-deleted]] — a product has been removed from the catalog.
- [[doc|product-platform/adr/adr-001-use-transactional-outbox]] — a product has been removed from the catalog.

## Architecture decisions

The key decisions that shaped this system. Search, filter by status, or sort by clicking a column.
