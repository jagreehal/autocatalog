---
name: Cart System
summary: Internal system that owns the customer's shopping cart and the checkout flow. It is the source of truth for cart contents and publishes an event when a cart is checked out.
owner: shopping-platform
---

## Overview

The **Cart System** owns the shopping cart at Acme Inc. It accepts commands to add and remove items and to check out, persists cart contents in the **Cart Database**, and asks the [[system|promotion-system]] to calculate the discounts that apply. When a cart is checked out it publishes a [[event|shopping-platform/shopping/cart-checked-out]] event.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component             | Type       | Responsibility                                                                            |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| [[service\|Cart API]] | Service    | Public-facing API. Handles add/remove/checkout commands and publishes the checkout event. |
| **Cart Database**     | Data store | PostgreSQL system of record for shopping carts and their items.                           |

## Messages this system publishes

- [[event|shopping-platform/shopping/cart-checked-out]] — a customer has checked out their cart.
