---
name: Loyalty
summary: The Loyalty subdomain rewards customers for shopping with Acme Inc. It awards points when orders complete, reverses them when orders are cancelled, and keeps each customer's points balance.
owner: customer-platform
parent: customer
---

## Overview

The **Loyalty** subdomain is part of the [[domain|customer]] domain. It listens to the order lifecycle from the Ordering domain and turns completed orders into loyalty points that customers can redeem on future purchases.

| Trigger                                               | Outcome                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [[event\|ordering-platform/ordering/order-completed]] | Points are awarded and [[event\|customer-platform/loyalty/loyalty-points-earned]] is published.                      |
| [[event\|ordering-platform/ordering/order-cancelled]] | Previously awarded points are removed and [[event\|customer-platform/loyalty/loyalty-points-reversed]] is published. |
