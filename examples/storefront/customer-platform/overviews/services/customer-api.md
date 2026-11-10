---
name: Customer API
summary: The public-facing API for customer profiles. Handles commands to register and update customers, serves customer reads, and publishes customer change events.
owner: customer-platform
---

## Overview

The **Customer API** is the front door to the Customer Management System. It validates incoming commands, persists customer data to the **Customer Database**, and publishes domain events (CustomerRegistered, CustomerUpdated) so the rest of the business can react to changes.

### Responsibilities

| Area             | Description                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Command handling | Validates and applies [[event\|customer/register-customer]] and [[event\|customer/update-customer]].                                        |
| Reads            | Serves [[event\|customer/get-customer]] directly from the customer database.                                                                |
| Event publishing | Emits [[event\|customer-platform/customer/customer-registered]] and [[event\|customer-platform/customer/customer-updated]] on every change. |
| Persistence      | Reads from and writes to the **Customer Database** (system of record).                                                                      |
