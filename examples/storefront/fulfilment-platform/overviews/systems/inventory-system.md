---
name: Inventory System
summary: Internal system that tracks stock and reserves it for orders. It is the source of truth for available inventory and confirms whether stock can be reserved.
owner: fulfilment-platform
---

## Overview

The **Inventory System** owns stock levels at Acme Inc. During checkout it receives [[event|ordering/reserve-inventory]] and confirms whether stock is available — replying with [[event|fulfilment-platform/fulfilment/inventory-reserved]] or [[event|fulfilment-platform/fulfilment/inventory-unavailable]]. It also handles [[event|fulfilment/release-inventory]] (when a reservation is no longer needed) and serves [[event|fulfilment/get-stock-level]] lookups from the **Inventory Database**.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                      | Type       | Responsibility                                                                           |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| [[service\|Inventory Service]] | Service    | Reserves and releases stock, serves stock-level queries, and publishes inventory events. |
| **Inventory Database**         | Data store | PostgreSQL system of record for stock levels and reservations.                           |

## Messages this system publishes

- [[event\|fulfilment-platform/fulfilment/inventory-reserved]] — stock was successfully reserved for an order.
- [[event\|fulfilment-platform/fulfilment/inventory-unavailable]] — stock could not be reserved.
