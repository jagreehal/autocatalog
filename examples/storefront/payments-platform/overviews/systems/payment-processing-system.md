---
name: Payment Processing System
summary: Internal system that orchestrates payment for orders. It authorizes payments, requests charges from the external payment processor, handles the outcome, and issues refunds.
owner: payments-platform
---

## Overview

The **Payment Processing System** is the internal heart of the Payments domain. When the Ordering domain sends [[event|ordering/authorize-payment]], the [[service|Payment API]] records the intent in the **Payment Database** and the [[service|Payment Worker]] requests a charge from the external [[system|stripe]] via [[event|payments-platform/payments/payment-requested]]. Stripe reports the outcome back as [[event|payments-platform/payments/payment-succeeded]] or [[event|payments-platform/payments/payment-failed]], which the worker records. The system also issues refunds via [[event|payments-platform/payments/refund-requested]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                   | Type       | Responsibility                                                  |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| [[service\|Payment API]]    | Service    | Receives authorization requests and records payment intent.     |
| [[service\|Payment Worker]] | Service    | Drives charges and refunds against Stripe and records outcomes. |
| **Payment Database**        | Data store | PostgreSQL system of record for payments and refunds.           |

## Messages this system publishes

- [[event\|payments-platform/payments/payment-requested]] — a charge has been requested from the payment processor.
- [[event\|payments-platform/payments/refund-requested]] — a refund has been requested from the payment processor.
