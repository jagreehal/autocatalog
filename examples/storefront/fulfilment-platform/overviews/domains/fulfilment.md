---
name: Fulfilment
summary: The Fulfilment domain gets a confirmed order to the customer. It reserves stock, picks and packs orders in the warehouse, and hands them to carriers for delivery.
owner: fulfilment-platform
---

## Overview

The **Fulfilment** domain is responsible for the physical side of an order — making sure stock is available, picking and packing it, and shipping it to the customer. It owns three internal systems and integrates with external carriers:

### How the systems work together

When an order is completed, the **Warehouse System** picks and packs it, having relied on the **Inventory System** to reserve stock earlier in checkout. Once packed, the **Shipping System** creates a shipment with an external **Carrier**, which delivers it to the customer and reports progress back.

### Subdomains

The [[domain|returns]] subdomain handles the reverse journey — accepting return requests, approving them, and confirming when items arrive back so Payments can refund the customer and Inventory can restock.

## Value Chain

A Wardley map of the Fulfilment domain. Delivery is the promise customers see, carriers are a commodity we rent, and warehouse automation is the most novel part of the chain.

```mermaid
wardley-beta
title Fulfilment value chain

anchor Customer [0.96, 0.62]
component Delivery Promise [0.86, 0.50]
component Stock Reservation [0.72, 0.46]
component Pick and Pack [0.64, 0.34]
component Shipment Booking [0.56, 0.60]
component Warehouse Automation [0.36, 0.22]
component Carrier Network [0.40, 0.88]
component Inventory Database [0.26, 0.86]
component Cloud Compute [0.10, 0.94]

Customer -> Delivery Promise
Delivery Promise -> Stock Reservation
Delivery Promise -> Shipment Booking
Stock Reservation -> Inventory Database
Shipment Booking -> Pick and Pack
Shipment Booking -> Carrier Network
Pick and Pack -> Warehouse Automation
Inventory Database -> Cloud Compute

evolve Warehouse Automation 0.52
evolve Shipment Booking 0.82

note "Robotic picking pilot in the main warehouse" [0.30, 0.06]
note "Consolidate carriers behind a multi carrier aggregator" [0.50, 0.70]
```

## System Diagram

The systems in this domain, how they relate, and the people who interact with them.
