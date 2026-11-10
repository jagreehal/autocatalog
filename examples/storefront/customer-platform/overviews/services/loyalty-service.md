---
name: Loyalty Service
summary: Awards loyalty points when orders complete and reverses them when orders are cancelled. Owns the points ledger and customer balances.
owner: customer-platform
---

## Overview

The **Loyalty Service** consumes [[event|ordering-platform/ordering/order-completed]] and [[event|ordering-platform/ordering/order-cancelled]] from the Ordering domain. It records points in the **Loyalty Database** and publishes [[event|customer-platform/loyalty/loyalty-points-earned]] or [[event|customer-platform/loyalty/loyalty-points-reversed]] so that promotions and customer notifications can react.

### Responsibilities

| Area        | Description                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Earning     | Awards points on [[event\|ordering-platform/ordering/order-completed]] and emits [[event\|customer-platform/loyalty/loyalty-points-earned]].    |
| Reversal    | Removes points on [[event\|ordering-platform/ordering/order-cancelled]] and emits [[event\|customer-platform/loyalty/loyalty-points-reversed]]. |
| Persistence | Reads from and writes to the **Loyalty Database**.                                                                                              |
