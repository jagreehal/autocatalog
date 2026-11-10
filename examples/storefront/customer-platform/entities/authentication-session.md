---
name: Authentication Session
summary: A successful customer authentication session.
identifier: sessionId
properties:
  - name: sessionId
    type: UUID
    required: true
    description: Unique authentication session identifier.
  - name: accountId
    type: UUID
    required: true
    description: Account authenticated in the session.
    references: customer-account
    referencesIdentifier: accountId
  - name: authenticatedAt
    type: datetime
    required: true
    description: Time authentication succeeded.
  - name: expiresAt
    type: datetime
    required: true
    description: Time the session expires.
domains:
  - customer
---

## Overview

Authentication Session represents successful login behavior emitted by [[event|customer-platform/customer/customer-authenticated]].
