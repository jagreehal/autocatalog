---
name: Review API
summary: The public-facing API for product reviews. Accepts review submissions, serves published reviews, and is the entry point into the Reviews & Ratings domain.
owner: reviews-platform
---

## Overview

The **Review API** is the front door to the Reviews & Ratings domain. It validates incoming [[event|reviews/submit-review]] commands, persists reviews to the **Review Database**, and publishes [[event|reviews-platform/reviews/review-submitted]]. It also serves [[event|reviews/get-product-reviews]], reading published reviews from the **Review Database** and aggregate ratings from the **Rating Cache**.

### Responsibilities

| Area             | Description                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Command handling | Validates and applies [[event\|reviews/submit-review]].                                     |
| Reads            | Serves [[event\|reviews/get-product-reviews]] from the review database and rating cache.    |
| Eventing         | Publishes [[event\|reviews-platform/reviews/review-submitted]] for moderation.              |
| Persistence      | Writes to the **Review Database**; reads from the **Review Database** and **Rating Cache**. |
