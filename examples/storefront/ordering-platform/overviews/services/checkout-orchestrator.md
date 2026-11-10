---
name: Checkout Orchestrator
summary: Runs the checkout saga. Reserves inventory, authorizes payment and creates the order, coordinating the steps that turn a checked-out cart into a confirmed order.
owner: ordering-platform
---

## Overview

The **Checkout Orchestrator** is the brain of the Checkout System. Once the [[service|Checkout API]] hands it a checkout, it runs the checkout saga step by step:

1. **Reserve inventory** — sends [[event|ordering/reserve-inventory]] to hold stock for the cart's items.
2. **Authorize payment** — sends [[event|ordering/authorize-payment]] to authorize the order total.
3. **Create the order** — sends [[event|ordering/create-order]] to the [[system|order-management-system]].

If any step fails, the orchestrator compensates the earlier steps (releasing the reservation, voiding the authorization) so the customer is never left in an inconsistent state.

### Responsibilities

| Area           | Description                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Inventory      | Reserves stock via [[event\|ordering/reserve-inventory]].                                               |
| Payment        | Authorizes the order total via [[event\|ordering/authorize-payment]].                                   |
| Order creation | Creates the order via [[event\|ordering/create-order]] against the [[system\|order-management-system]]. |
| Compensation   | Rolls back earlier steps if a later step fails.                                                         |
