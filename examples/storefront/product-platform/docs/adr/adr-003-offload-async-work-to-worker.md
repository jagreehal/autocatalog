---
title: 'ADR-003: Offload long-running catalog work to a dedicated worker'
owner: product-platform
summary: Slow and asynchronous catalog tasks (enrichment, image processing, bulk imports) run in a separate Product Worker so the Product API stays fast and predictable.
status: accepted
date: 2026-02-18
---

## Context

Some catalog operations are slow or bursty: enriching products with derived attributes, processing and optimising images, and ingesting large supplier feeds. Running this work inline in the [[service|Product API]] request path would make API latency unpredictable and couple the responsiveness of create/update/read operations to whatever heavy job happens to be running.

## Decision

The Product Catalog System runs a dedicated [[service|Product Worker]] for long-running and asynchronous tasks. The [[service|Product API]] handles validation, persistence and the outbox write synchronously, then returns; the worker picks up enrichment, media processing and bulk imports independently, reading from and writing back to the **Product Database**.

## Consequences

- The Product API has a small, predictable surface and stays fast under load.
- Heavy work can be scaled, retried and scheduled independently of the API.
- Some product attributes are **eventually** populated after creation, so consumers must not assume every derived field is present immediately.
- There are now two services writing to the **Product Database**, so write paths must respect the same invariants and avoid conflicting updates.
