---
name: Review Moderation Worker
summary: Asynchronous worker that screens submitted reviews for spam, abuse and policy violations, then publishes or rejects them.
owner: reviews-platform
---

## Overview

The **Review Moderation Worker** consumes [[event|reviews-platform/reviews/review-submitted]] (and [[event|reviews-platform/reviews/review-flagged]] for already-published reviews), screens each review (automated checks plus thresholds for manual review), and records the outcome on the **Review Database**. It then publishes either [[event|reviews-platform/reviews/review-published]] or [[event|reviews-platform/reviews/review-rejected]].

### Responsibilities

| Area        | Description                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Moderation  | Screens reviews for spam, abuse and policy violations.                                                                 |
| Outcome     | Publishes [[event\|reviews-platform/reviews/review-published]] or [[event\|reviews-platform/reviews/review-rejected]]. |
| Persistence | Records the moderation decision on the **Review Database**.                                                            |
