---
name: Customer Address
summary: A saved address attached to a customer profile.
identifier: addressId
properties:
  - name: addressId
    type: UUID
    required: true
    description: Unique address identifier.
  - name: customerId
    type: UUID
    required: true
    description: Customer who owns the address.
    references: customer-profile
    referencesIdentifier: customerId
  - name: countryCode
    type: string
    required: true
    description: ISO country code.
  - name: postalCode
    type: string
    required: true
    description: Postal or ZIP code.
domains:
  - customer
---

## Overview

Customer Address supports checkout and fulfilment while remaining owned by the Customer domain.
