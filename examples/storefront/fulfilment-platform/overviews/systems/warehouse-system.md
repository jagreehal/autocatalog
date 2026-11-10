---
name: Warehouse System
summary: Internal system that picks and packs orders in the warehouse. It reacts to completed orders, organises picking, and signals when an order is packed and ready to ship.
owner: fulfilment-platform
---

## Overview

The **Warehouse System** turns a completed order into a packed parcel. When the Ordering domain publishes [[event|ordering-platform/ordering/order-completed]], the [[service|Warehouse Service]] creates a picking job, the [[service|Picking Worker]] works through it, and the system publishes [[event|fulfilment-platform/fulfilment/order-packed]] and then [[event|fulfilment-platform/fulfilment/order-ready-for-shipping]] for the [[system|shipping-system]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                      | Type       | Responsibility                                                  |
| ------------------------------ | ---------- | --------------------------------------------------------------- |
| [[service\|Warehouse Service]] | Service    | Receives completed orders and orchestrates picking and packing. |
| [[service\|Picking Worker]]    | Service    | Works through picking jobs on the warehouse floor.              |
| **Warehouse Database**         | Data store | PostgreSQL store of picking jobs and their status.              |

## Messages this system publishes

- [[event\|fulfilment-platform/fulfilment/order-packed]] — an order has been picked and packed.
- [[event\|fulfilment-platform/fulfilment/order-ready-for-shipping]] — a packed order is ready to be shipped.
