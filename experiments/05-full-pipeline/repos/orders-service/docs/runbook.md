---
title: Orders runbook
owner: '@acme/orders'
summary: What to do when orders stop flowing.
about:
  - event/orders/order.placed
  - service/OrderService
---

If Billing stops invoicing, check that `OrderService` still publishes
`order.placed` on `orders.events`.
