---
name: Refund
summary: Money returned against a captured payment.
identifier: refundId
domains: [payments]
properties:
  - { name: refundId, type: string, required: true }
  - { name: payment, type: string, required: true, references: payment, relationType: belongs-to }
  - {
      name: amount,
      type: integer,
      required: true,
      description: No more than what is left to refund.,
    }
---
