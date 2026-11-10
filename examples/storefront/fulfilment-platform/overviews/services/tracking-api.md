---
name: Tracking API
summary: The carrier's API for reporting delivery progress. It notifies Acme Inc when a shipment is created, delivered, or fails.
owner: fulfilment-platform
---

## Overview

The **Tracking API** is how the carrier reports delivery progress back to Acme Inc. After a shipment is created via the [[service|Shipping API]], it emits [[event|fulfilment-platform/fulfilment/shipment-created]], then [[event|fulfilment-platform/fulfilment/shipment-delivered]] on success or [[event|fulfilment-platform/fulfilment/shipment-failed]] if delivery cannot be completed.
