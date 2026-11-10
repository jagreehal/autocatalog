---
name: Webhook Endpoint
summary: Stripe's webhook delivery for payment and refund outcomes. It notifies Acme Inc whether a charge succeeded or failed, and when a refund is processed.
owner: payments-platform
---

## Overview

The **Webhook Endpoint** is how Stripe reports outcomes back to Acme Inc. After processing a request from the [[service|Payments API]], it delivers [[event|payments-platform/payments/payment-succeeded]], [[event|payments-platform/payments/payment-failed]] or [[event|payments-platform/payments/refund-processed]] to the [[system|payment-processing-system]].
