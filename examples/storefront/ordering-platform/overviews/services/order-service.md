---
name: Order Service
summary: The system of record for orders. Creates and cancels orders, serves order lookups, and publishes events as orders move through their lifecycle.
owner: ordering-platform
---

## Overview

The **Order Service** is the heart of the Order Management System. It receives [[event|ordering/create-order]] from the [[system|checkout-system]], persists orders to the **Order Database**, and serves order lookups via [[event|ordering/get-order]]. It also handles [[event|ordering/cancel-order]], and consumes [[event|fulfilment-platform/fulfilment/order-packed]] from the Fulfilment domain to track when an order has been packed. As orders move through their lifecycle it publishes detailed events covering creation, confirmation, amendments, operational holds, fulfilment, completion, cancellation, and archival.

### Responsibilities

| Area               | Description                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Order creation     | Handles [[event\|ordering/create-order]] from the Checkout System and persists the order.                          |
| Order cancellation | Handles [[event\|ordering/cancel-order]] and compensates downstream where needed.                                  |
| Order lookups      | Serves [[event\|ordering/get-order]] from the **Order Database**.                                                  |
| Event publishing   | Emits a complete order lifecycle stream for fulfilment, customer communications, support, and analytics consumers. |
