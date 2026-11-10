---
name: Returns
summary: The Returns subdomain handles items customers send back. It accepts return requests, approves them against the returns policy, and confirms when returned items arrive at the warehouse so they can be refunded and restocked.
owner: fulfilment-platform
parent: fulfilment
---

## Overview

The **Returns** subdomain is part of the [[domain|fulfilment]] domain and runs the reverse logistics journey through the [[system|returns-system]].

1. A customer sends [[event|returns/request-return]] and the [[service|Returns API]] publishes [[event|fulfilment-platform/returns/return-requested]].
2. The [[service|Returns Processor]] checks the returns policy and publishes [[event|fulfilment-platform/returns/return-approved]].
3. When the parcel reaches the warehouse it publishes [[event|fulfilment-platform/returns/return-received]] — Payments refunds the customer and Inventory restocks the items.
