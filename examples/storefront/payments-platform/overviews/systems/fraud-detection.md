---
name: Fraud Detection
summary: External provider that screens payments for fraud. It consumes payment requests and returns a pass or fail verdict.
owner: payments-platform
---

## Overview

**Fraud Detection** is an external provider Acme Inc uses to screen payments for fraud. It is owned and operated by a third party — modelled here as an **external system** so the catalog shows how the [[system|payment-processing-system]] integrates with it.

It consumes [[event|payments-platform/payments/payment-requested]] and returns a verdict via [[event|payments-platform/payments/fraud-check-passed]] or [[event|payments-platform/payments/fraud-check-failed]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component              | Type    | Responsibility                                               |
| ---------------------- | ------- | ------------------------------------------------------------ |
| [[service\|Fraud API]] | Service | Screens a payment for fraud and returns a pass/fail verdict. |

## Messages this system publishes

- [[event\|payments-platform/payments/fraud-check-passed]] — a payment passed fraud screening.
- [[event\|payments-platform/payments/fraud-check-failed]] — a payment failed fraud screening.
