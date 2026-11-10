---
name: Ordering
summary: The Ordering domain turns a checked-out cart into a confirmed order. It orchestrates checkout — reserving inventory, authorizing payment and creating the order — and owns the lifecycle of every order.
owner: ordering-platform
---

## Overview

The **Ordering** domain is responsible for everything that happens once a customer commits to buy — from the moment their cart is checked out to a confirmed, fulfilled order. It is split into two systems:

### How the systems work together

When the [[domain|shopping]] domain checks out a cart, the **Checkout System** takes over. It orchestrates the steps needed to place an order — reserving inventory, authorizing payment, and finally asking the **Order Management System** to create the order. The Order Management System then owns that order for the rest of its life, publishing events as it is created, completed or cancelled.

## Value Chain

A Wardley map of the Ordering domain. Placing an order is the most visible need in the business, the checkout orchestration behind it is custom, and the workflow tooling it runs on is evolving towards a product.

```mermaid
wardley-beta
title Ordering value chain

anchor Customer [0.96, 0.56]
component Place Order [0.88, 0.52]
component Checkout Orchestration [0.76, 0.40]
component Order Management [0.66, 0.52]
component Inventory Reservation [0.54, 0.50]
component Payment Authorization [0.54, 0.64]
component Workflow Engine [0.38, 0.46]
component Event Bus [0.40, 0.76]
component Order Database [0.24, 0.86]
component Cloud Compute [0.10, 0.94]

Customer -> Place Order
Place Order -> Checkout Orchestration
Checkout Orchestration -> Inventory Reservation
Checkout Orchestration -> Payment Authorization
Checkout Orchestration -> Order Management
Checkout Orchestration -> Workflow Engine
Order Management -> Event Bus
Order Management -> Order Database
Workflow Engine -> Cloud Compute
Order Database -> Cloud Compute

evolve Workflow Engine 0.74

note "Replace bespoke saga code with a managed workflow engine" [0.32, 0.24]
```

## System Diagram

The systems in this domain, how they relate, and the people who interact with them.

## Resource Diagram

The components that make up this domain.

## Architecture Graph

Where Ordering sits in the wider architecture — its systems and messages, and the neighbouring domains it talks to.
