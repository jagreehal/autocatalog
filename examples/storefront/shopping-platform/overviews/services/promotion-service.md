---
name: Promotion Service
summary: Evaluates promotion rules and calculates the discount that applies to a cart. Receives discount requests and publishes the calculated result.
owner: shopping-platform
---

## Overview

The **Promotion Service** is the heart of the Promotion System. It receives [[event|shopping/calculate-discount]] requests from the [[system|cart-system]], evaluates the applicable rules from the **Promotion Database**, and publishes a [[event|shopping-platform/shopping/discount-calculated]] event with the result. It also consumes [[event|customer-platform/loyalty/loyalty-points-earned]] from the Customer domain to unlock loyalty-tier promotions.

### Responsibilities

| Area                 | Description                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Discount calculation | Handles [[event\|shopping/calculate-discount]] and evaluates promotion rules.                                           |
| Loyalty promotions   | Consumes [[event\|customer-platform/loyalty/loyalty-points-earned]] to unlock loyalty-tier promotions for the customer. |
| Rules                | Reads promotion and discount rules from the **Promotion Database**.                                                     |
| Event publishing     | Emits [[event\|shopping-platform/shopping/discount-calculated]] with the calculated result.                             |
