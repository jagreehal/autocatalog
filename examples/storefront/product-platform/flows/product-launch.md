---
title: Product Launch
summary: How a new product goes from a merchandiser's draft to live on the storefront — enriched, indexed for search, stocked, given a launch offer and announced to customers — and how it's pulled if customers report a fault.
steps:
  - id: merchandiser
    title: Merchandiser
    actor:
      name: Merchandiser
      summary: Someone on the trading team adding a new product to the range.
    next_step:
      id: create_product
      label: Submits the new product
  - id: create_product
    title: Create Product
    custom:
      title: Create Product
      summary: 'Command: Create Product'
    next_step:
      id: product_api
      label: Create
  - id: product_api
    title: Product API
    summary: Validates the product and saves it with an outbox record in one transaction.
    service: Product API
    next_steps:
      - id: product_database
        label: Valid
      - id: validation_failed
        label: Missing data
  - id: validation_failed
    title: Rejected
    custom:
      title: Rejected
      summary: The product is missing required details (price, images or category). The merchandiser fixes it and resubmits.
  - id: product_database
    title: Product Database
    custom:
      title: Product Database
    next_step:
      id: product_created
      label: Outbox publishes
  - id: product_created
    title: Product Created
    summary: Three teams pick the new product up in parallel.
    event: catalog/product-created
    next_steps:
      - id: product_worker
        label: Enrich
      - id: get_stock_level
        label: Check stock
      - id: calculate_discount
        label: Set a launch offer
  - id: product_worker
    title: Product Worker
    summary: Generates image renditions and variant data for the new product.
    service: Product Worker
    next_step:
      id: product_updated
      label: Images and variants added
  - id: product_updated
    title: Product Updated
    event: catalog/product-updated
    next_step:
      id: search_indexing
      label: Index for search
  - id: search_indexing
    title: Product Search Indexing
    summary: Gets the product into the search index. Click to expand the sub-flow.
    custom:
      title: Product Search Indexing
      summary: 'Flow: Product Search Indexing'
    next_step:
      id: search_index
      label: Indexed
  - id: search_index
    title: Search Index
    custom:
      title: Search Index
    next_step:
      id: launch_ready
      label: Searchable
  - id: get_stock_level
    title: Get Stock Level
    custom:
      title: Get Stock Level
      summary: 'Command: Get Stock Level'
    next_step:
      id: inventory_service
      label: Query
  - id: inventory_service
    title: Inventory Service
    service: Inventory Service
    next_steps:
      - id: launch_ready
        label: Stock received
      - id: awaiting_stock
        label: Nothing in the warehouse
  - id: awaiting_stock
    title: Awaiting stock
    custom:
      title: Awaiting stock
      summary: The launch waits until the first delivery is booked into the warehouse.
  - id: calculate_discount
    title: Calculate Discount
    custom:
      title: Calculate Discount
      summary: 'Command: Calculate Discount'
    next_step:
      id: promotion_service
      label: 10% launch week offer
  - id: promotion_service
    title: Promotion Service
    service: Promotion Service
    next_step:
      id: discount_calculated
      label: Offer scheduled
  - id: discount_calculated
    title: Discount Calculated
    event: shopping/discount-calculated
    next_step:
      id: launch_ready
      label: Offer live
  - id: launch_ready
    title: Launch checklist
    custom:
      title: Launch checklist
      summary: The product goes live once it's searchable, in stock and its launch offer is set.
    next_step:
      id: notification_service
      label: Announce the launch
  - id: notification_service
    title: Notification Service
    summary: Emails customers who opted in to new-product announcements.
    service: Notification Service
    next_step:
      id: customer_notified
      label: Launch email sent
  - id: customer_notified
    title: Customer Notified
    event: notifications/customer-notified
    next_step:
      id: shopper
      label: Opens the email
  - id: shopper
    title: Shopper
    actor:
      name: Shopper
      summary: A customer who clicked through from the launch email.
    next_step:
      id: search_products
      label: Searches for it
  - id: search_products
    title: Search Products
    custom:
      title: Search Products
      summary: 'Command: Search Products'
    next_step:
      id: search_api
      label: Query
  - id: search_api
    title: Search API
    service: Search API
    next_step:
      id: get_product
      label: Opens the product page
  - id: get_product
    title: Get Product
    custom:
      title: Get Product
      summary: 'Command: Get Product'
    next_step:
      id: product_api_read
      label: Query
  - id: product_api_read
    title: Product API
    service: Product API
    next_step:
      id: get_product_reviews
      label: Load reviews
  - id: get_product_reviews
    title: Get Product Reviews
    custom:
      title: Get Product Reviews
      summary: 'Command: Get Product Reviews'
    next_step:
      id: review_api
      label: Query
  - id: review_api
    title: Review API
    service: Review API
    next_steps:
      - id: product_live
        label: Good reviews
      - id: flag_review
        label: Customers report a fault
  - id: product_live
    title: Product live
    custom:
      title: Product live
      summary: The product is searchable, in stock, on offer and selling — with reviews on its page.
  - id: flag_review
    title: Flag Review
    custom:
      title: Flag Review
      summary: 'Command: Flag Review'
    next_step:
      id: review_flagged
      label: Report a safety issue
  - id: review_flagged
    title: Review Flagged
    event: reviews/review-flagged
    next_step:
      id: delete_product
      label: Merchandiser pulls it
  - id: delete_product
    title: Delete Product
    custom:
      title: Delete Product
      summary: 'Command: Delete Product'
    next_step:
      id: product_api_recall
      label: Withdraw
  - id: product_api_recall
    title: Product API
    service: Product API
    next_step:
      id: product_deleted
      label: Removed from the range
  - id: product_deleted
    title: Product Deleted
    event: catalog/product-deleted
    next_step:
      id: product_withdrawn
      label: Dropped from search
  - id: product_withdrawn
    title: Product withdrawn
    custom:
      title: Product withdrawn
      summary: The product is off the storefront and out of search while the fault is investigated.
---

## Overview

**Product Launch** follows a new product from a merchandiser's draft to selling on the storefront. It's a good flow for showing how several teams work on the same event in parallel, and how their work comes together before launch.

| Domain         | What it does in this flow                                 |
| -------------- | --------------------------------------------------------- |
| **Catalog**    | Creates and enriches the product, and gets it into search |
| **Fulfilment** | Confirms there's stock to sell                            |
| **Shopping**   | Sets up the launch week offer                             |
| **Customer**   | Announces the launch (the **Notifications** subdomain)    |
| **Reviews**    | Shows reviews — and raises the alarm if something's wrong |

## Try it

- **Group by** (top right) — try **Team**: three teams react to one `ProductCreated` event in parallel, then their work comes together at the launch checklist.
- **Walk through** (bottom left) — step through the launch. At each branch, pick what happens next: valid or missing data, stock or no stock, good reviews or a reported fault.
- **Product Search Indexing** is a sub-flow — click it to expand how the product gets into search.

## Paths through the flow

1. **Launch** — the product is created and saved, then enriched and indexed, stocked and given a launch offer in parallel. Once all three are done it's announced, and shoppers find it through search.
2. **Rejected** — the product is missing required details and goes back to the merchandiser.
3. **Awaiting stock** — nothing is in the warehouse yet, so the launch waits.
4. **Recall** — customers report a fault and the product is pulled from the storefront and search.
