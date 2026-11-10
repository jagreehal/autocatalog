---
title: 'ADR-002: Use PostgreSQL as the product system of record'
owner: product-platform
summary: Product data is stored in a single PostgreSQL database that acts as the authoritative system of record, with derived stores (like the search index) rebuilt from it.
status: accepted
date: 2026-02-12
---

## Context

Products are a small-to-medium, strongly relational dataset (products, categories, pricing, lifecycle status) that needs transactional integrity, an enforceable schema, and the ability to write a change and its outbox event atomically. We also want a single, unambiguous source of truth so that derived stores — such as the [[system|search-system]]'s index — can be treated as disposable and rebuilt at any time.

## Decision

The Product Catalog System uses a single **PostgreSQL** database, the **Product Database**, as the authoritative system of record. It holds the `products` table and the outbox table (see [[doc|product-platform/adr/adr-001-use-transactional-outbox]]). The [[service|Product API]] is the only writer on the request path; the [[service|Product Worker]] performs asynchronous enrichment.

Any other representation of product data elsewhere in the business is a **derived read model**, not a source of truth, and must be rebuildable by replaying product events.

## Consequences

- Strong consistency and transactional outbox writes are straightforward with a single relational store.
- The search index and any future read models can be rebuilt from the catalog, keeping them disposable.
- The database is a scaling focal point; heavy read traffic should be served from read replicas or downstream read models rather than the primary.
- Schema changes need migrations and care, since this is the authoritative store.
