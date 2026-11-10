---
name: Returns Processor
summary: Applies the returns policy to new requests and tracks returned parcels until they arrive back at the warehouse.
owner: fulfilment-platform
---

## Overview

The **Returns Processor** consumes [[event|fulfilment-platform/returns/return-requested]], checks the returns window and item eligibility, and publishes [[event|fulfilment-platform/returns/return-approved]]. When the warehouse scans the returned parcel it publishes [[event|fulfilment-platform/returns/return-received]], which Payments uses to refund the customer and Inventory uses to restock.

### Responsibilities

| Area        | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Approval    | Applies the returns policy and emits [[event\|fulfilment-platform/returns/return-approved]].      |
| Receipt     | Confirms returned items arrived and emits [[event\|fulfilment-platform/returns/return-received]]. |
| Persistence | Reads from and writes to the **Returns Database**.                                                |
