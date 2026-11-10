---
name: Payment API
summary: Receives payment authorization requests from the Ordering domain and records the payment intent, kicking off the charge against the payment processor.
owner: payments-platform
---

## Overview

The **Payment API** is the entry point to the Payment Processing System. It receives [[event|ordering/authorize-payment]] from the Ordering domain, records the payment intent in the **Payment Database**, and leaves the [[service|Payment Worker]] to drive the charge against [[system|stripe]].

### Responsibilities

| Area          | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| Authorization | Receives and validates [[event\|ordering/authorize-payment]]. |
| Persistence   | Records payment intent in the **Payment Database**.           |

## Architecture Graph

How PaymentAPI connects to the rest of the catalog — the messages it exchanges and the systems around it.
