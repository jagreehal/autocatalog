---
name: Checkout System
summary: Internal system that orchestrates checkout. When a cart is checked out it reserves inventory, authorizes payment, and asks the Order Management System to create the order.
owner: ordering-platform
---

## Overview

The **Checkout System** drives the checkout flow at Acme Inc. When the [[domain|shopping]] domain checks out a cart, the [[service|Checkout API]] receives the [[event|shopping/checkout-cart]] command and hands it to the [[service|Checkout Orchestrator]]. The orchestrator runs the checkout saga — reserving inventory via [[event|ordering/reserve-inventory]], authorizing payment via [[event|ordering/authorize-payment]], and finally creating the order via [[event|ordering/create-order]] against the [[system|order-management-system]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                          | Type    | Responsibility                                                               |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------- |
| [[service\|Checkout API]]          | Service | Entry point for checkout. Receives the checkout command and starts the flow. |
| [[service\|Checkout Orchestrator]] | Service | Runs the checkout saga — reserve inventory, authorize payment, create order. |

## Messages this system sends

- [[event\|ordering/reserve-inventory]] — reserve stock for the items in the cart.
- [[event\|ordering/authorize-payment]] — authorize payment for the order total.
- [[event\|ordering/create-order]] — create the order in the Order Management System.

## Architecture Graph

The checkout system's neighbourhood in the wider architecture.
