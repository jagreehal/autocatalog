---
title: Capturing a payment
summary: How an authorised payment becomes money taken, or does not.
entity: payment
field: status
steps:
  - id: started
    title: Capture started
    transition: { from: authorised, to: capturing }
    code:
      - { file: docs/runbook.md }
    rules:
      - A payment is captured once, however many times the worker retries
    stuck:
      signs: status is capturing and no capture task is running
      recovery: docs/runbook.md
    next_steps:
      - { id: captured, label: the card network accepts }
      - { id: failed, label: the card network refuses }
      - { id: lookup-failed, label: the fee lookup fails }
  - id: lookup-failed
    title: Fee lookup failed, capture continues
    summary: Writes a note on the payment and carries on. No state changes.
    next_step: captured
  - id: captured
    title: Payment captured
    transition: { from: capturing, to: captured, via: worker }
    next_step: refunded
  - id: failed
    title: Payment failed
    transition: { from: capturing, to: failed, via: worker }
  - id: refunded
    title: Payment refunded
    transition: { from: captured, to: refunded }
---

The capture worker takes authorised payments off a queue and asks the card network to settle them.
