---
name: Cart API
summary: The public-facing API for shopping carts. Handles commands to add and remove items and to check out, and publishes an event when a cart is checked out.
owner: shopping-platform
---

## Overview

The **Cart API** is the front door to the Cart System. It validates incoming commands, persists cart contents to the **Cart Database**, asks the [[system|promotion-system]] to calculate discounts via [[event|shopping/calculate-discount]], and publishes a [[event|shopping-platform/shopping/cart-checked-out]] event when the customer checks out.

### Responsibilities

| Area             | Description                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cart management  | Validates and applies [[event\|shopping/add-item-to-cart]], [[event\|shopping/remove-item-from-cart]] and [[event\|shopping/checkout-cart]]. |
| Discounts        | Requests pricing from the Promotion System via [[event\|shopping/calculate-discount]].                                                       |
| Event publishing | Emits [[event\|shopping-platform/shopping/cart-checked-out]] when a cart is checked out.                                                     |
| Persistence      | Reads from and writes to the **Cart Database** (system of record).                                                                           |
