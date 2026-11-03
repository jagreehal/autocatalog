---
title: Ledger
owner: Finance
summary: Books every settled payment.
---

# Ledger

LedgerService reads `payment.completed` from the `ledger.payments` queue,
which the infrastructure repository binds to the `payments` exchange.
