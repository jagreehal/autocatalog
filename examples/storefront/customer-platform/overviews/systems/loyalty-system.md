---
name: Loyalty System
summary: Internal system that calculates, stores and reverses customer loyalty points in response to order events.
owner: customer-platform
---

## Overview

The **Loyalty System** turns orders into rewards. The [[service|Loyalty Service]] consumes [[event|ordering-platform/ordering/order-completed]] and [[event|ordering-platform/ordering/order-cancelled]] from the [[system|order-management-system]], updates balances in the **Loyalty Database**, and publishes points events for the rest of the business.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                    | Type       | Responsibility                                             |
| ---------------------------- | ---------- | ---------------------------------------------------------- |
| [[service\|Loyalty Service]] | Service    | Awards and reverses loyalty points and maintains balances. |
| **Loyalty Database**         | Data store | Points ledger and customer balances.                       |

## Messages this system sends

- [[event\|customer-platform/loyalty/loyalty-points-earned]] — points were awarded for a completed order.
- [[event\|customer-platform/loyalty/loyalty-points-reversed]] — points were removed after an order was cancelled.
