---
title: Investigating a capture potentially stuck in capturing
owner: Payments
tier: standard
ticket: SUP-1042
entity: payment
nature: question
status: draft
date: 2026-11-06
flow: capturing-a-payment
step: started
---

## What was seen

A payment stayed in `capturing` after the worker restarted.

## What was happening

Not yet known. Nothing writes a status if the worker dies mid-capture.

## How to spot it

`status` is `capturing` and no capture task is running.

## How to recover

Follow the replay runbook. Re-running sets `captured`, which does not mean money moved.
