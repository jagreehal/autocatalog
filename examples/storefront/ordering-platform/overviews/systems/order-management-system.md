---
name: Order Management System
summary: Internal system that is the source of truth for orders. It creates orders, tracks their lifecycle, and publishes events as orders are created, completed and cancelled.
owner: ordering-platform
---

## Overview

The **Order Management System** owns the order at Acme Inc. It accepts the [[event|ordering/create-order]] command from the [[system|checkout-system]], persists orders in the **Order Database**, and serves order lookups via [[event|ordering/get-order]]. As an order moves through its lifecycle it publishes [[event|ordering-platform/ordering/order-created]], [[event|ordering-platform/ordering/order-completed]] and [[event|ordering-platform/ordering/order-cancelled]] events for the rest of the business to react to.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                  | Type       | Responsibility                                                            |
| -------------------------- | ---------- | ------------------------------------------------------------------------- |
| [[service\|Order Service]] | Service    | Creates, cancels and serves orders, and publishes order lifecycle events. |
| **Order Database**         | Data store | PostgreSQL system of record for orders and their items.                   |

## Messages this system publishes

- [[event\|ordering-platform/ordering/order-created]] — a new order has been created.
- [[event\|ordering-platform/ordering/order-completed]] — an order has been fulfilled and completed.
- [[event\|ordering-platform/ordering/order-cancelled]] — an order has been cancelled.
