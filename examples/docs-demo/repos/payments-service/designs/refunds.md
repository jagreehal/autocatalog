---
title: Refunds
summary: Refunds move out of PaymentService into a service of their own.
status: proposed
resources:
  - { id: payments, type: domain, name: Payments }
  - { id: refunds, type: system, name: Refunds, parent: payments }
  - { ref: service/PaymentService, parent: payments }
  - { ref: service/LedgerService, parent: payments }
  - { ref: event/payments/payment.captured }
  - {
      id: RefundService,
      type: service,
      parent: refunds,
      summary: Pays money back against a captured payment.,
    }
  - { id: refund.requested, type: command, name: Request refund }
  - { id: refund.issued, type: event, name: Refund issued }
relations:
  - { from: PaymentService, to: payment.captured, kind: sends }
  - { from: LedgerService, to: payment.captured, kind: receives }
  - { from: RefundService, to: payment.captured, kind: receives }
  - { from: RefundService, to: refund.requested, kind: receives }
  - { from: RefundService, to: refund.issued, kind: sends }
  - { from: LedgerService, to: refund.issued, kind: receives }
notes:
  - { text: Who approves a refund over £500?, resource: RefundService }
---

RefundService keeps its own copy of each captured payment, so a refund never
calls back into PaymentService.
