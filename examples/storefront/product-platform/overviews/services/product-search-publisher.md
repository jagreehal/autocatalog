---
name: Product Search Publisher
summary: Reads product changes from the product database (outbox) and reliably publishes product-created, product-updated and product-deleted events for the Search System to consume.
owner: product-platform
---

## Overview

The **Product Search Publisher** is the bridge between the Product Catalog System and the rest of the business. It uses the [transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html): the [[service|Product API]] records every product change in the **Product Database**, and this service reliably reads those changes and publishes them as [[event|product-platform/catalog/product-created]], [[event|product-platform/catalog/product-updated]] and [[event|product-platform/catalog/product-deleted]] events.

This guarantees that product changes are never lost and are delivered to the [[system|search-system]] in order.

### Responsibilities

| Area                | Description                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbox polling      | Reads unpublished product changes from the **Product Database**.                                                                                                                                        |
| Reliable publishing | Publishes [[event\|product-platform/catalog/product-created]], [[event\|product-platform/catalog/product-updated]] and [[event\|product-platform/catalog/product-deleted]] with at-least-once delivery. |
| Ordering            | Preserves per-product ordering of change events.                                                                                                                                                        |
