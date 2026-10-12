---
title: Incident communications
owner: Reliability
tier: critical
summary: Who says what, to whom, during a customer-visible incident.
tags:
  - incident
  - policy
related:
  - payments-service/runbook
---

# Incident communications

This is company policy. It applies to every service, and it is committed in the
handbook repository because the policy changes on a different schedule from any
one service.

## Within five minutes

Open an incident channel and name an incident lead. The lead owns
communication; whoever is fixing the problem should not also be writing updates.

## Every thirty minutes

Post an update even when the update is "no change". Silence gets read as
progress, and the second question in every post-incident review is why the
status page went quiet.

## What goes in an update

- What customers can and cannot do right now.
- What is being tried, in one sentence.
- When the next update lands.

Never publish a cause before it is confirmed. A retracted cause costs more trust
than an hour of "still investigating".

## Handover

Incidents that cross a shift boundary get a written handover in the channel: the
current theory, what has been ruled out, and what is running unattended. The
service runbook says how to reach the on-call engineer for that service.
