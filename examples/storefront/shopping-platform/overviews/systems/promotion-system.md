---
name: Promotion System
summary: Internal system that calculates the discounts and promotions that apply to a cart. It owns promotion rules and returns calculated discounts to the Cart System.
owner: shopping-platform
---

## Overview

The **Promotion System** owns the discount and promotion rules at Acme Inc. It receives requests to calculate the discount for a cart, evaluates the applicable rules from the **Promotion Database**, and publishes a [[event|shopping-platform/shopping/discount-calculated]] event with the result. It provides discounts to the [[system|cart-system]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                      | Type       | Responsibility                                                 |
| ------------------------------ | ---------- | -------------------------------------------------------------- |
| [[service\|Promotion Service]] | Service    | Evaluates promotion rules and calculates discounts for a cart. |
| **Promotion Database**         | Data store | PostgreSQL store of promotion and discount rules.              |

## Messages this system publishes

- [[event|shopping-platform/shopping/discount-calculated]] — a discount has been calculated for a cart.
