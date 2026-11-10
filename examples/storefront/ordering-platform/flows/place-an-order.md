---
title: Place an Order
summary: The end-to-end journey from a customer checking out their cart to a confirmed order — spanning the Shopping and Ordering domains, including the checkout saga and its failure path.
steps:
  - id: shopper_checks_out
    title: Shopper checks out
    actor:
      name: Shopper
      summary: The customer confirms their cart and starts checkout.
    next_step:
      id: checkout_cart_command
      label: Check out cart
  - id: checkout_cart_command
    title: Checkout Cart
    custom:
      title: Checkout Cart
      summary: 'Command: Checkout Cart'
    next_step:
      id: cart_api
      label: Price and finalise cart
  - id: cart_api
    title: Cart API
    service: Cart API
    next_step:
      id: cart_checked_out
      label: Publish checkout
  - id: cart_checked_out
    title: Cart Checked Out
    event: shopping/cart-checked-out
    next_step:
      id: checkout_api
      label: Start checkout flow
  - id: checkout_api
    title: Checkout API
    service: Checkout API
    next_step:
      id: checkout_orchestrator
      label: Run checkout saga
  - id: checkout_orchestrator
    title: Checkout Orchestrator
    service: Checkout Orchestrator
    next_steps:
      - id: reserve_inventory
        label: Reserve inventory
      - id: authorize_payment
        label: Authorize payment
  - id: reserve_inventory
    title: Reserve Inventory
    custom:
      title: Reserve Inventory
      summary: 'Command: Reserve Inventory'
    next_step:
      id: authorize_payment
      label: Inventory held
  - id: authorize_payment
    title: Authorize Payment
    custom:
      title: Authorize Payment
      summary: 'Command: Authorize Payment'
    next_steps:
      - id: create_order
        label: Payment authorized
      - id: checkout_failed
        label: Authorization declined
  - id: create_order
    title: Create Order
    custom:
      title: Create Order
      summary: 'Command: Create Order'
    next_step:
      id: order_service
      label: Persist order
  - id: order_service
    title: Order Service
    service: Order Service
    next_step:
      id: order_created
      label: Publish order created
  - id: order_created
    title: Order Created
    event: ordering/order-created
    next_step:
      id: order_confirmed
      label: Confirm to customer
  - id: order_confirmed
    title: Order confirmed
    custom:
      title: Order confirmed
      summary: The customer's order is placed and confirmed. Fulfilment begins.
  - id: checkout_failed
    title: Checkout failed
    custom:
      title: Checkout failed
      summary: A checkout step failed (e.g. payment declined). The orchestrator compensates earlier steps and cancels the order.
    next_step:
      id: order_cancelled
      label: Cancel order
  - id: order_cancelled
    title: Order Cancelled
    event: ordering/order-cancelled
---

## Overview

**Place an Order** is the headline business flow at Acme Inc. It begins in the [[domain|shopping]] domain, when a shopper checks out their cart, and finishes in the [[domain|ordering]] domain, with a confirmed order — or a compensated, cancelled one if a step fails.

## How it works

1. The shopper checks out — the [[service|Cart API]] prices the cart and publishes [[event|shopping-platform/shopping/cart-checked-out]].
2. The [[service|Checkout API]] picks this up and hands it to the [[service|Checkout Orchestrator]].
3. The orchestrator runs the saga: [[event|ordering/reserve-inventory]] then [[event|ordering/authorize-payment]].
4. On success it sends [[event|ordering/create-order]] to the [[service|Order Service]], which publishes [[event|ordering-platform/ordering/order-created]].
5. If any step fails, the orchestrator compensates the earlier steps and the order is cancelled via [[event|ordering-platform/ordering/order-cancelled]].
