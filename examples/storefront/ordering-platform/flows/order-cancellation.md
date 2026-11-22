---
title: Order Cancellation
summary: How an order is cancelled — whether requested by the customer or triggered by a failure — and the events that tell the rest of the business to unwind it.
steps:
  - id: cancellation_trigger
    title: Cancellation requested
    actor:
      name: Shopper or System
      summary: A customer asks to cancel, or a downstream failure (payment, inventory) forces a cancellation.
    next_step:
      id: cancel_order_command
      label: Cancel order
  - id: cancel_order_command
    title: Order cancellation requested
    command: { ref: ordering/cancel-order }
    next_step:
      id: order_service
      label: Handle cancellation
  - id: order_service
    title: Order Service
    service: Order Service
    systems: [Order Database]
    decidedBy: Order
    rules:
      - An order can only be cancelled before it is completed. Completed orders must go through returns instead.
    next_steps:
      - id: order_cancelled
        label: Not yet completed, so mark cancelled
      - id: not_cancellable
        label: Already completed
  - id: order_cancelled
    title: Order Cancelled
    event: ordering/order-cancelled
    policy: Whenever an order is cancelled, release reserved inventory, void or refund the payment, and stop fulfilment
  - id: not_cancellable
    title: Cannot cancel
    custom:
      title: Cannot cancel
      summary: The order has already been completed and cannot be cancelled. The customer is directed to the returns process.
    policy: Whenever a completed order can't be cancelled, direct the customer to returns
---

## Overview

**Order Cancellation** documents how the [[system|order-management-system]] cancels an order. Cancellation can be requested by a shopper or forced by a downstream failure during checkout. Only orders that have not yet completed can be cancelled.

## How it works

1. A [[event|ordering/cancel-order]] command reaches the [[service|Order Service]].
2. The service checks the cancellation policy — only `CREATED` orders are cancellable.
3. If eligible, the order is marked cancelled in the **Order Database** and [[event|ordering-platform/ordering/order-cancelled]] is published.
4. Downstream consumers react to [[event|ordering-platform/ordering/order-cancelled]] to release inventory, refund payment and stop fulfilment.
5. If the order is already completed, cancellation is rejected and the customer is sent to the returns process.
