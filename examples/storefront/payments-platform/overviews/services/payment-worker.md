---
name: Payment Worker
summary: Drives charges and refunds against the external payment processor and records the outcomes. It requests payments and refunds, and consumes the success/failure events Stripe returns.
owner: payments-platform
---

## Overview

The **Payment Worker** drives money movement. It requests charges from the external [[system|stripe]] via [[event|payments-platform/payments/payment-requested]] and refunds via [[event|payments-platform/payments/refund-requested]], then consumes the [[event|payments-platform/payments/payment-succeeded]] and [[event|payments-platform/payments/payment-failed]] events Stripe returns and records the outcome in the **Payment Database**. It also refunds customers for returned items when the Fulfilment domain publishes [[event|fulfilment-platform/returns/return-received]].

### Responsibilities

| Area        | Description                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Charging    | Requests charges via [[event\|payments-platform/payments/payment-requested]].                                                             |
| Refunds     | Requests refunds via [[event\|payments-platform/payments/refund-requested]].                                                              |
| Returns     | Consumes [[event\|fulfilment-platform/returns/return-received]] and requests a refund for the returned items.                             |
| Outcomes    | Consumes [[event\|payments-platform/payments/payment-succeeded]] / [[event\|payments-platform/payments/payment-failed]] and records them. |
| Persistence | Reads from and writes to the **Payment Database**.                                                                                        |
