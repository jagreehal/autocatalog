---
title: Re-running a stuck capture
summary: An operator releases a payment so a new capture task can start.
entity: payment
field: status
steps:
  - id: rerun
    actor: { name: Support engineer }
    summary: Sets captured so a task can start. No money has moved.
    transition: { from: capturing, to: captured, via: operator }
---
