---
title: Orders runbook
owner: '@acme/orders'
tier: critical
summary: What to do when orders stop flowing.
related:
  - handbook/incident-policy
about:
  - event/orders/order.placed
  - service/OrderService
---

Check that `OrderService` is publishing `order.placed`. Follow the incident
policy if customers can see it.
