---
name: Carrier
summary: External carrier that delivers shipments to customers. It accepts shipment requests and reports delivery progress back.
owner: fulfilment-platform
---

## Overview

The **Carrier** is the external delivery company Acme Inc uses to ship orders to customers. It is owned and operated by a third party — modelled here as an **external system** so the catalog shows how the [[system|shipping-system]] integrates with it.

It receives [[event|fulfilment/create-shipment]] and reports progress back via [[event|fulfilment-platform/fulfilment/shipment-created]], [[event|fulfilment-platform/fulfilment/shipment-delivered]] and [[event|fulfilment-platform/fulfilment/shipment-failed]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                 | Type    | Responsibility                                    |
| ------------------------- | ------- | ------------------------------------------------- |
| [[service\|Shipping API]] | Service | Accepts shipment requests and dispatches parcels. |
| [[service\|Tracking API]] | Service | Reports delivery progress back to Acme Inc.       |

## Messages this system publishes

- [[event\|fulfilment-platform/fulfilment/shipment-created]] — a shipment has been created and dispatched.
- [[event\|fulfilment-platform/fulfilment/shipment-delivered]] — a shipment was delivered to the customer.
- [[event\|fulfilment-platform/fulfilment/shipment-failed]] — a shipment could not be delivered.
