---
name: Product Worker
summary: Background worker that handles long-running and asynchronous catalog work off the request path, such as enrichment, image processing and bulk imports.
owner: product-platform
---

## Overview

The **Product Worker** keeps the [[service|Product API]] fast by taking slow or asynchronous work off the request path. It reads from and writes back to the **Product Database**, handling jobs like data enrichment, image processing and bulk catalog imports.

### Responsibilities

| Area         | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| Enrichment   | Augments product records with derived data after they are created or updated. |
| Media        | Processes and optimises product images asynchronously.                        |
| Bulk imports | Ingests large product feeds without blocking the API.                         |
| Persistence  | Reads from and writes to the **Product Database**.                            |
