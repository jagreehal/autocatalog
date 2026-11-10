---
title: Review Submission
summary: How a customer's product review travels from submission, through moderation, to being published and folded into the product's aggregate rating.
steps:
  - id: customer_submits
    title: Customer submits a review
    actor:
      name: Customer
      summary: A customer writes a review and rating for a product they purchased.
    next_step:
      id: review_api
      label: Submit review
  - id: review_api
    title: Review API
    service: Review API
    next_step:
      id: review_database
      label: Store review
  - id: review_database
    title: Review Database
    custom:
      title: Review Database
    next_step:
      id: review_submitted
      label: Review stored
  - id: review_submitted
    title: Review Submitted
    event: reviews/review-submitted
    next_step:
      id: moderation_worker
      label: Screen review
  - id: moderation_worker
    title: Review Moderation Worker
    service: Review Moderation Worker
    next_steps:
      - id: review_published
        label: Approved
      - id: review_rejected
        label: Rejected
  - id: review_published
    title: Review Published
    event: reviews/review-published
    next_step:
      id: rating_aggregator
      label: Update rating
  - id: review_rejected
    title: Review Rejected
    event: reviews/review-rejected
    next_step:
      id: rejected_outcome
      label: Not shown
  - id: rating_aggregator
    title: Rating Aggregator
    service: Rating Aggregator
    next_step:
      id: rating_cache
      label: Write aggregate
  - id: rating_cache
    title: Rating Cache
    custom:
      title: Rating Cache
    next_step:
      id: published_outcome
      label: Visible on storefront
  - id: published_outcome
    title: Review is live
    custom:
      title: Review is live
      summary: The review is published and the product's aggregate rating is updated and served from the cache.
  - id: rejected_outcome
    title: Review rejected
    custom:
      title: Review rejected
      summary: The review failed moderation. It is kept for audit but never shown on the storefront.
---

## Overview

**Review Submission** documents the journey of a customer review from submission through moderation to publication. A review is only ever folded into a product's rating once it has been approved.

## How it works

1. A customer submits a review via the [[service|Review API]], which stores it in the **Review Database** and publishes [[event|reviews-platform/reviews/review-submitted]].
2. The [[service|Review Moderation Worker]] screens the review and publishes either [[event|reviews-platform/reviews/review-published]] or [[event|reviews-platform/reviews/review-rejected]].
3. On approval, the [[service|Rating Aggregator]] updates the product's aggregate rating in the **Rating Cache** and the review goes live.
