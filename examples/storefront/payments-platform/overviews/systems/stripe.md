---
name: Stripe
summary: External payment processor used by Acme Inc to charge cards and issue refunds. It receives payment and refund requests and reports outcomes back via webhook events.
owner: payments-platform
---

## Overview

[Stripe](https://stripe.com) is the external payment processor Acme Inc uses to charge customer cards and issue refunds. It is owned and operated by Stripe — modelled here as an **external system** so the catalog shows how the [[system|payment-processing-system]] integrates with it.

Stripe receives [[event|payments-platform/payments/payment-requested]] and [[event|payments-platform/payments/refund-requested]], and reports outcomes back via [[event|payments-platform/payments/payment-succeeded]], [[event|payments-platform/payments/payment-failed]] and [[event|payments-platform/payments/refund-processed]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                     | Type    | Responsibility                                                           |
| ----------------------------- | ------- | ------------------------------------------------------------------------ |
| [[service\|Payments API]]     | Service | Accepts charge and refund requests and processes them.                   |
| [[service\|Webhook Endpoint]] | Service | Delivers payment and refund outcomes back to Acme Inc as webhook events. |

## Messages this system publishes

- [[event\|payments-platform/payments/payment-succeeded]] — a charge succeeded.
- [[event\|payments-platform/payments/payment-failed]] — a charge failed.
- [[event\|payments-platform/payments/refund-processed]] — a refund was processed.
