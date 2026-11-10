---
name: Returns System
summary: Internal system that accepts, approves and tracks customer returns through to their arrival back at the warehouse.
owner: fulfilment-platform
---

## Overview

The **Returns System** owns the returns journey. The [[service|Returns API]] accepts [[event|returns/request-return]] from customers, and the [[service|Returns Processor]] approves returns and confirms receipt. Both share the **Returns Database**.

## Resource Diagram

The services and messages that make up this system.

## What's inside

| Component                      | Type       | Responsibility                                          |
| ------------------------------ | ---------- | ------------------------------------------------------- |
| [[service\|Returns API]]       | Service    | Accepts return requests from customers.                 |
| [[service\|Returns Processor]] | Service    | Applies the returns policy and tracks returned parcels. |
| **Returns Database**           | Data store | Return requests and their status.                       |

## Messages this system sends

- [[event\|fulfilment-platform/returns/return-requested]] — a customer asked to return items.
- [[event\|fulfilment-platform/returns/return-approved]] — the return passed policy checks.
- [[event\|fulfilment-platform/returns/return-received]] — returned items arrived at the warehouse.
