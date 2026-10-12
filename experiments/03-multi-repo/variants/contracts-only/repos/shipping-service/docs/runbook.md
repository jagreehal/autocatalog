---
title: Shipping runbook
owner: Logistics
tier: standard
summary: Shipping reads order.placed and publishes shipment.dispatched.
related:
  - orders-service/runbook
about:
  - event/orders/order.placed
  - event/shipping/shipment.dispatched
---

Shipping only reads `orderId` from `order.placed`. A stuck queue here is
usually a stuck carrier integration, not an orders problem.
