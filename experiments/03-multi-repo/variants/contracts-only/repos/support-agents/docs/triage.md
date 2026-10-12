---
title: Triage agent
owner: Support
tier: standard
summary: What the triage agent does with a new order.
related:
  - handbook/incident-policy
about:
  - agent/triage-agent
---

The agent reads `orderId` from `order.placed` and opens a ticket when the order
has not shipped within a day.
