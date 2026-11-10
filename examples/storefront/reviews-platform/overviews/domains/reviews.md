---
name: Reviews & Ratings
summary: The Reviews & Ratings domain owns customer feedback on products — how reviews are submitted, moderated, published and aggregated into the star ratings shown across the storefront.
owner: reviews-platform
---

## Overview

The **Reviews & Ratings** domain is responsible for everything to do with customer feedback on products: accepting reviews, moderating them for quality and abuse, publishing the approved ones, and aggregating them into the star ratings shown across the storefront.

Unlike most other domains in the catalog, Reviews & Ratings is modelled **without systems** — its services, data stores and flows hang directly off the domain.

### What's inside

| Component                             | Type       | Responsibility                                                          |
| ------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| [[service\|Review API]]               | Service    | Accepts review submissions and serves product reviews.                  |
| [[service\|Review Moderation Worker]] | Service    | Screens submitted reviews and publishes or rejects them.                |
| [[service\|Rating Aggregator]]        | Service    | Keeps each product's aggregate rating in sync as reviews are published. |
| **Review Database**                   | Data Store | System of record for reviews and their moderation state.                |
| **Rating Cache**                      | Data Store | Fast read store for aggregate product ratings.                          |
| **Review**                            | Entity     | The core review aggregate.                                              |

The diagram below shows the services, data stores and messages that make up this domain.

## How it works

1. A customer submits a review via the [[service\|Review API]], which stores it and publishes [[event\|reviews-platform/reviews/review-submitted]].
2. The [[service\|Review Moderation Worker]] screens the review and publishes either [[event\|reviews-platform/reviews/review-published]] or [[event\|reviews-platform/reviews/review-rejected]].
3. The [[service\|Rating Aggregator]] consumes [[event\|reviews-platform/reviews/review-published]] and updates the product's aggregate rating, publishing [[event\|reviews-platform/reviews/rating-updated]].

Once a review is live, customers can interact with it: [[event\|reviews/vote-review-helpful]] updates its helpful count (publishing [[event\|reviews-platform/reviews/review-helpful-voted]]), and [[event\|reviews/flag-review]] reports it for re-moderation (publishing [[event\|reviews-platform/reviews/review-flagged]], which the [[service\|Review Moderation Worker]] re-screens).
