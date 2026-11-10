---
name: Fraud API
summary: External fraud screening API. It consumes payment requests and returns a pass or fail verdict for each.
owner: payments-platform
---

## Overview

The **Fraud API** screens payments for fraud. It consumes [[event|payments-platform/payments/payment-requested]] from the [[system|payment-processing-system]] and returns a verdict — [[event|payments-platform/payments/fraud-check-passed]] or [[event|payments-platform/payments/fraud-check-failed]] — which the Payments domain uses to allow or block the charge.
