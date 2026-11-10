---
name: Customer Account
summary: The identity account used to authenticate a customer.
identifier: accountId
aggregateRoot: true
properties:
  - name: accountId
    type: UUID
    required: true
    description: Unique account identifier.
  - name: customerId
    type: UUID
    required: true
    description: Customer profile linked to this account.
    references: customer-profile
    referencesIdentifier: customerId
  - name: provider
    type: string
    required: true
    description: Identity provider name.
  - name: status
    type: string
    required: true
    description: Account lifecycle state.
domains:
  - customer
---

## Overview

Customer Account belongs to the Identity Provider boundary and should not be queried directly by order, payment or review services.
