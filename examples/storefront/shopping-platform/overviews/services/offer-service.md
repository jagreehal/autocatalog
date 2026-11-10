---
name: Offer Service
summary: Builds follow-up offers for customers after they order, priced with the Shopping domain's promotions.
owner: shopping-platform
---

## Overview

The **Offer Service** listens for [[event|ordering-platform/ordering/order-confirmed]] from the Ordering domain and builds a follow-up offer for the customer. It prices each offer by sending [[event|shopping/calculate-discount]] to the Shopping domain.
