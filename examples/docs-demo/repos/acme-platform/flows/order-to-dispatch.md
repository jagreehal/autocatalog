---
title: Order to dispatch
summary: From a customer paying to a carrier collecting the parcel, across payments, orders and shipping.
lanes: { by: domain, style: lanes }
steps:
  - id: customer
    actor:
      name: Customer
      summary: Checks out on the storefront.
    next_step:
      id: pay
      label: Pays
  - id: pay
    title: Take payment
    service: PaymentService
    next_steps:
      - id: captured
        label: Card accepted
      - id: place
        label: Payment authorised
      - id: declined
        label: Card declined
  - id: declined
    title: Ask for another card
    summary: The storefront shows the decline and keeps the basket.
    next_step:
      id: pay
      label: Tries another card
  - id: captured
    event: payments/payment.captured
    next_step:
      id: ledger
      label: Books the money
  - id: ledger
    service: LedgerService
  - id: place
    service: OrderService
    summary: Takes the order once payment is authorised.
    next_step: placed
  - id: placed
    event: orders/order.placed
    next_step:
      id: ship
      label: Dispatch
  - id: ship
    service: ShippingService
    next_step:
      id: carrier
      label: Books a collection
  - id: carrier
    externalSystem:
      name: Carrier
      summary: Collects the parcel from the warehouse.
---

An order is placed only once its payment is authorised, so a declined card
never reaches shipping. The ledger books captured money on its own; nothing
in dispatch waits for it.
