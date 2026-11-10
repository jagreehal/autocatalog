---
name: Rating Aggregator
summary: Keeps each product's aggregate star rating up to date as reviews are published, and serves it fast from a cache.
owner: reviews-platform
---

## Overview

The **Rating Aggregator** consumes [[event|reviews-platform/reviews/review-published]] and recomputes the affected product's aggregate rating (average score and review count). It writes the result to the **Rating Cache** for fast reads and publishes [[event|reviews-platform/reviews/rating-updated]] so other domains can stay in sync.

### Responsibilities

| Area        | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| Aggregation | Recomputes average rating and review count per product.                       |
| Caching     | Writes aggregate ratings to the **Rating Cache**.                             |
| Eventing    | Publishes [[event\|reviews-platform/reviews/rating-updated]] on every change. |
