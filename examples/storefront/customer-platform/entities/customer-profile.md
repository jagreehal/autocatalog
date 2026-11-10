---
name: Customer Profile
summary: The customer details Acme uses for commerce interactions.
identifier: customerId
aggregateRoot: true
properties:
  - name: customerId
    type: UUID
    required: true
    description: Unique customer identifier.
  - name: email
    type: string
    required: true
    description: Customer email address.
  - name: displayName
    type: string
    required: false
    description: Preferred customer display name.
  - name: status
    type: string
    required: true
    description: Customer profile state.
domains:
  - customer
---

## Overview

Customer Profile is owned by [[system|customer-management-system]] and is separate from authentication credentials.
