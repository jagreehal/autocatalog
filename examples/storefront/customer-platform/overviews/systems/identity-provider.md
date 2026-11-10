---
name: Identity Provider
summary: The identity system that authenticates customers. It is the source of truth for credentials and login, verifies sign-in attempts, and emits an event when a customer successfully authenticates.
owner: customer-platform
---

## Overview

The **Identity Provider** authenticates customers for Acme Inc. It exposes an OAuth-style API, verifies credentials against the **User Directory**, and emits a [[event|customer-platform/customer/customer-authenticated]] event on a successful sign-in so other systems can react. It provides authentication for the [[system|customer-management-system]].

## Context Diagram

How this system relates to the other systems around it.

## Resource Diagram

The services, data stores and messages that make up this system.

## What's inside

| Component              | Type       | Responsibility                                                                                       |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| [[service\|OAuth API]] | Service    | OAuth-style authentication API. Handles authentication requests and publishes authentication events. |
| **User Directory**     | Data store | The directory of customer credentials and identities.                                                |

## Messages this system publishes

- [[event|customer-platform/customer/customer-authenticated]] — a customer has successfully authenticated.
