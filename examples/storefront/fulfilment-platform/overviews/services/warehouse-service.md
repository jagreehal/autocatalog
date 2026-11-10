---
name: Warehouse Service
summary: Orchestrates picking and packing in the warehouse. It reacts to completed orders, creates picking jobs, and signals when an order is ready to ship.
owner: fulfilment-platform
---

## Overview

The **Warehouse Service** runs warehousing. When the Ordering domain publishes [[event|ordering-platform/ordering/order-completed]], it creates a picking job in the **Warehouse Database** for the [[service|Picking Worker]] to work through. Once the order is packed it publishes [[event|fulfilment-platform/fulfilment/order-ready-for-shipping]] for the [[system|shipping-system]].
