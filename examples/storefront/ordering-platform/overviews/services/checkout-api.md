---
name: Checkout API
summary: The entry point to the Checkout System. Receives the checkout command from the Shopping domain and starts the checkout flow.
owner: ordering-platform
---

## Overview

The **Checkout API** is the front door to the Checkout System. When the [[domain|shopping]] domain checks out a cart, this service receives the [[event|shopping/checkout-cart]] command, validates it, and hands the work to the [[service|Checkout Orchestrator]] to run the checkout saga.

### Responsibilities

| Area                  | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| Checkout entry        | Receives and validates [[event\|shopping/checkout-cart]] from the Shopping domain. |
| Orchestration handoff | Starts a checkout saga in the [[service\|Checkout Orchestrator]].                  |
