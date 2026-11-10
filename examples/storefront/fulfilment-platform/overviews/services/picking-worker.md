---
name: Picking Worker
summary: Works through picking jobs on the warehouse floor and signals when an order has been picked and packed.
owner: fulfilment-platform
---

## Overview

The **Picking Worker** processes picking jobs created by the [[service|Warehouse Service]]. As warehouse staff pick and pack each order, the worker updates the job in the **Warehouse Database** and publishes [[event|fulfilment-platform/fulfilment/order-packed]] when the order is complete.
