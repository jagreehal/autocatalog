---
name: Shipping System
summary: Internal system that hands packed orders to carriers. It reacts to ready-for-shipping orders and creates shipments with an external carrier.
owner: fulfilment-platform
---

## Overview

The **Shipping System** connects Acme Inc to its carriers. When the [[system|warehouse-system]] publishes [[event|fulfilment-platform/fulfilment/order-ready-for-shipping]], the [[service|Shipping API]] selects a carrier and the [[service|Carrier Adapter]] sends a [[event|fulfilment/create-shipment]] to the external [[system|carrier]] to dispatch the parcel.

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                    | Type    | Responsibility                                                  |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| [[service\|Shipping API]]    | Service | Receives ready-for-shipping orders and selects a carrier.       |
| [[service\|Carrier Adapter]] | Service | Translates and sends shipment requests to the external carrier. |

## Messages this system sends

- [[event\|fulfilment/create-shipment]] — create a shipment with the carrier.
