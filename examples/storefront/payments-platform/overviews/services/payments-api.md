---
name: Payments API
summary: Stripe's API for charging cards and issuing refunds. Acme Inc's Payment Processing System calls it to request payments and refunds.
owner: payments-platform
---

## Overview

The **Payments API** is Stripe's external interface for charging cards and issuing refunds. The [[system|payment-processing-system]] sends [[event|payments-platform/payments/payment-requested]] and [[event|payments-platform/payments/refund-requested]], and Stripe processes them and reports the outcome back through its [[service|Webhook Endpoint]].
