---
name: Shipping API
summary: Receives ready-for-shipping orders, selects a carrier, and kicks off shipment creation.
owner: fulfilment-platform
---

## Overview

The **Shipping API** is the entry point to the Shipping System. It consumes [[event|fulfilment-platform/fulfilment/order-ready-for-shipping]] from the [[system|warehouse-system]], selects an appropriate carrier, and hands off to the [[service|Carrier Adapter]] to create the shipment.
