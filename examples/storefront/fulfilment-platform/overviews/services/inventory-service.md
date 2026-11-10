---
name: Inventory Service
summary: The system of record for stock. Reserves and releases inventory, serves stock-level queries, and publishes events when stock is reserved or unavailable.
owner: fulfilment-platform
---

## Overview

The **Inventory Service** is the heart of the Inventory System. It receives [[event|ordering/reserve-inventory]] during checkout and replies with [[event|fulfilment-platform/fulfilment/inventory-reserved]] or [[event|fulfilment-platform/fulfilment/inventory-unavailable]]. It also handles [[event|fulfilment/release-inventory]] and serves [[event|fulfilment/get-stock-level]] reads, all backed by the **Inventory Database**. When returned items arrive it consumes [[event|fulfilment-platform/returns/return-received]] to restock them.

### Responsibilities

| Area             | Description                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Reservations     | Handles [[event\|ordering/reserve-inventory]] and [[event\|fulfilment/release-inventory]].                                              |
| Restocking       | Consumes [[event\|fulfilment-platform/returns/return-received]] and returns resellable items to stock.                                  |
| Lookups          | Serves [[event\|fulfilment/get-stock-level]] from the **Inventory Database**.                                                           |
| Event publishing | Emits [[event\|fulfilment-platform/fulfilment/inventory-reserved]] and [[event\|fulfilment-platform/fulfilment/inventory-unavailable]]. |
