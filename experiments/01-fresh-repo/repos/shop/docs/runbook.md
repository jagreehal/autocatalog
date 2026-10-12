---
title: Orders runbook
owner: Orders
about:
  - event/orders/order.placed
---

When orders stop flowing, check that `OrderService` is still publishing
`order.placed`, then that `BillingService` is consuming it.
