---
name: Returns API
summary: Public API customers use to start a return. Validates the request against the original order and records it.
owner: fulfilment-platform
---

## Overview

The **Returns API** receives [[event|returns/request-return]] from customers, stores the request in the **Returns Database** and publishes [[event|fulfilment-platform/returns/return-requested]] for the [[service|Returns Processor]].

### Responsibilities

| Area             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| Intake           | Handles [[event\|returns/request-return]] and validates the order and items. |
| Persistence      | Writes new return requests to the **Returns Database**.                      |
| Event publishing | Emits [[event\|fulfilment-platform/returns/return-requested]].               |
