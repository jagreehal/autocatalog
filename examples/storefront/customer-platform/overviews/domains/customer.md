---
name: Customer
summary: The Customer domain owns who our customers are — how they register, how their profile is maintained, and how they are authenticated across Acme Inc. It is the source of truth for customer identity and profile data.
owner: customer-platform
---

## Overview

The **Customer** domain is responsible for the lifecycle of every customer account at Acme Inc — registration, profile updates, and authentication. It is split into two systems:

### How the systems work together

The **Customer Management System** owns customer profile data — it accepts registration and update commands and publishes events when customers change. The **Identity Provider** handles authentication: it verifies credentials and emits an event when a customer successfully authenticates, which the rest of the business can react to.

### Subdomains

The Customer domain also contains two subdomains: [[domain|loyalty]] awards and reverses loyalty points as orders complete or are cancelled, and [[domain|notifications]] keeps customers informed by email, SMS and push in response to events from across Acme Inc.

## System Diagram

The systems in this domain, how they relate, and the people who interact with them.
