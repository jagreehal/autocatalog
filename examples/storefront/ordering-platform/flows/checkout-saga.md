---
title: Checkout Saga
summary: How the Checkout Orchestrator turns a checked-out cart into an order — reserving inventory, authorizing payment and creating the order, with compensation when a step fails.
steps:
  - id: cart_checked_out
    title: Cart Checked Out
    event: shopping/cart-checked-out
    next_step:
      id: checkout_api
      label: Receive checkout
  - id: checkout_api
    title: Checkout API
    service: Checkout API
    next_step:
      id: orchestrator
      label: Start saga
  - id: orchestrator
    title: Checkout Orchestrator
    service: Checkout Orchestrator
    next_step:
      id: reserve_inventory
      label: Step 1 — reserve inventory
  - id: reserve_inventory
    title: Reserve Inventory
    custom:
      title: Reserve Inventory
      summary: 'Command: Reserve Inventory'
    next_steps:
      - id: authorize_payment
        label: Reserved
      - id: compensate_release
        label: Out of stock
  - id: authorize_payment
    title: Authorize Payment
    custom:
      title: Authorize Payment
      summary: 'Command: Authorize Payment'
    next_steps:
      - id: create_order
        label: Authorized
      - id: compensate_release
        label: Declined
  - id: create_order
    title: Create Order
    custom:
      title: Create Order
      summary: 'Command: Create Order'
    next_step:
      id: saga_complete
      label: Order created
  - id: saga_complete
    title: Saga complete
    custom:
      title: Saga complete
      summary: Inventory reserved, payment authorized and order created. The saga succeeds.
  - id: compensate_release
    title: Compensate
    custom:
      title: Compensate and abort
      summary: A step failed. The orchestrator releases any reservation and voids any authorization, then aborts the saga without creating an order.
---

## Overview

The **Checkout Saga** is the heart of the [[system|checkout-system]]. It coordinates the steps that turn a checked-out cart into a confirmed order. Each step has a compensating action so a failure never leaves the customer in an inconsistent state.

## Steps

1. **Reserve inventory** — [[event|ordering/reserve-inventory]] holds stock for the cart's items.
2. **Authorize payment** — [[event|ordering/authorize-payment]] places a hold on the order total.
3. **Create order** — [[event|ordering/create-order]] persists the order in the [[system|order-management-system]].

If reservation or authorization fails, the orchestrator **compensates** — releasing the reservation and voiding the authorization — and aborts without creating an order.
