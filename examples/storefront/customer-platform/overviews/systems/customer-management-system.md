---
name: Customer Management System
summary: Internal system that is the source of truth for customer profile data. Owns the customer database and publishes customer change events for the rest of the business to consume.
owner: customer-platform
---

## Overview

The **Customer Management System** is the system of record for customer profiles at Acme Inc. It accepts commands to register and update customers, persists them in the **Customer Database**, and emits domain events whenever customer data changes so downstream systems can react. It delegates authentication to the [[system|identity-provider]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component                 | Type       | Responsibility                                                                                                |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| [[service\|Customer API]] | Service    | Public-facing API. Handles register/update commands and customer reads, and publishes customer change events. |
| **Customer Database**     | Data store | PostgreSQL system of record for all customer profile data.                                                    |

## Messages this system publishes

When customer data changes, the system emits these events:

- [[event|customer-platform/customer/customer-registered]] — a new customer has registered.
- [[event|customer-platform/customer/customer-updated]] — an existing customer's profile has changed.
