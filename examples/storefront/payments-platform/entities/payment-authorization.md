---
name: Payment Authorization
summary: Approval from a payment provider to reserve funds for an order.
identifier: authorizationId
properties:
  - name: authorizationId
    type: UUID
    required: true
    description: Unique authorization identifier.
  - name: paymentId
    type: UUID
    required: true
    description: Payment this authorization belongs to.
    references: payment
    referencesIdentifier: paymentId
  - name: providerReference
    type: string
    required: true
    description: External payment provider reference.
  - name: authorizedAt
    type: datetime
    required: true
    description: Time authorization was granted.
domains:
  - payments
---

## Overview

Payment Authorization captures the result of [[event|ordering/authorize-payment]] and links Acme payment state to provider state.
