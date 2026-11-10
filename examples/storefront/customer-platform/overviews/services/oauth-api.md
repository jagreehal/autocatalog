---
name: OAuth API
summary: OAuth-style authentication API for the Identity Provider. Verifies customer credentials and publishes an event when a customer successfully authenticates.
owner: customer-platform
---

## Overview

The **OAuth API** is the authentication entry point for Acme Inc. It verifies credentials against the **User Directory** and, on a successful sign-in, publishes a [[event|customer-platform/customer/customer-authenticated]] event so other systems can react.

### Responsibilities

| Area             | Description                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Authentication   | Handles [[event\|customer/authenticate-customer]] and verifies credentials.                 |
| Event publishing | Emits [[event\|customer-platform/customer/customer-authenticated]] on a successful sign-in. |
| Credentials      | Reads from the **User Directory** — the source of truth for credentials.                    |
