---
name: Product API
summary: The public-facing API for the product catalog. Handles commands to create, update and delete products, serves product reads, and is the entry point into the Product Catalog System.
owner: product-platform
---

## Overview

The **Product API** is the front door to the Product Catalog System. It validates incoming commands, persists product data to the **Product Database**, and records every change to the outbox. The [[service|Product Search Publisher]] then turns those changes into the domain events the rest of the business consumes.

### Responsibilities

| Area             | Description                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Command handling | Validates and applies [[event\|catalog/create-product]], [[event\|catalog/update-product]] and [[event\|catalog/delete-product]]. |
| Reads            | Serves [[event\|catalog/get-product]] directly from the product database.                                                         |
| Change capture   | Records every product change to the outbox in the **Product Database** for the [[service\|Product Search Publisher]] to publish.  |
| Persistence      | Reads from and writes to the **Product Database** (system of record).                                                             |
