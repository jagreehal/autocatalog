---
title: Consuming order.placed
owner: Billing
summary: Billing invoices every placed order.
about:
  - event/orders/order.placed
  - event/billing/invoice.issued
---

Billing reads `orderId`, `total` and `currency` from `order.placed`, and issues
`invoice.issued` once the invoice exists.
