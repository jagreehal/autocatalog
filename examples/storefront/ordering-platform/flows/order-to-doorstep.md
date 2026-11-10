---
title: Order to Doorstep
summary: The end-to-end journey of an order, from a shopper finding a product to the parcel arriving at their door — and what happens when payment fails, stock runs out, delivery goes wrong or the customer sends it back. Crosses every business domain in the catalog.
steps:
  - id: shopper
    title: Shopper
    actor:
      name: Shopper
      summary: A customer browsing the storefront on web or mobile.
    next_step:
      id: search_products
      label: Searches the catalog
  - id: search_products
    title: Search Products
    summary: The storefront asks the search index for products matching the shopper's query.
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
      id: add_item_to_cart
      label: Shopper picks a product
  - id: add_item_to_cart
    title: Add Item To Cart
    custom:
      title: Add Item To Cart
      summary: 'Command: Add Item To Cart'
    next_step:
      id: cart_api_add
      label: Add to basket
  - id: cart_api_add
    title: Cart API
    summary: Holds the shopper's basket while they keep browsing.
    service: Cart API
    next_step:
      id: checkout_cart
      label: Shopper checks out
  - id: checkout_cart
    title: Checkout Cart
    custom:
      title: Checkout Cart
      summary: 'Command: Checkout Cart'
    next_step:
      id: authenticate_customer
      label: Sign in first
  - id: authenticate_customer
    title: Authenticate Customer
    custom:
      title: Authenticate Customer
      summary: 'Command: Authenticate Customer'
    next_step:
      id: oauth_api
      label: Verify session
  - id: oauth_api
    title: Identity Provider
    summary: The third-party identity provider confirms who the shopper is.
    service: OAuth API
    next_step:
      id: customer_authenticated
      label: Session valid
  - id: customer_authenticated
    title: Customer Authenticated
    event: customer/customer-authenticated
    next_step:
      id: cart_api_checkout
      label: Continue checkout
  - id: cart_api_checkout
    title: Cart API
    summary: Freezes the basket and prices it before handing it to Ordering.
    service: Cart API
    next_step:
      id: get_product
      label: Look up live prices
  - id: get_product
    title: Get Product
    custom:
      title: Get Product
      summary: 'Command: Get Product'
    next_step:
      id: product_api
      label: Query
  - id: product_api
    title: Product API
    service: Product API
    next_step:
      id: calculate_discount
      label: Prices returned
  - id: calculate_discount
    title: Calculate Discount
    custom:
      title: Calculate Discount
      summary: 'Command: Calculate Discount'
    next_step:
      id: promotion_service
      label: Apply promotions
  - id: promotion_service
    title: Promotion Service
    service: Promotion Service
    next_step:
      id: discount_calculated
      label: Codes and offers applied
  - id: discount_calculated
    title: Discount Calculated
    event: shopping/discount-calculated
    next_step:
      id: cart_checked_out
      label: Final total known
  - id: cart_checked_out
    title: Cart Checked Out
    event: shopping/cart-checked-out
    next_step:
      id: checkout_api
      label: Hand over to Ordering
  - id: checkout_api
    title: Checkout API
    service: Checkout API
    next_step:
      id: checkout_orchestrator
      label: Start checkout saga
  - id: checkout_orchestrator
    title: Checkout Orchestrator
    summary: Coordinates stock, payment and order creation, compensating if any step fails.
    service: Checkout Orchestrator
    next_step:
      id: reserve_inventory
      label: Step 1 — hold the stock
  - id: reserve_inventory
    title: Reserve Inventory
    custom:
      title: Reserve Inventory
      summary: 'Command: Reserve Inventory'
    next_step:
      id: inventory_service
      label: Reserve items
  - id: inventory_service
    title: Inventory Service
    service: Inventory Service
    next_steps:
      - id: inventory_reserved
        label: In stock
      - id: inventory_unavailable
        label: Out of stock
  - id: inventory_reserved
    title: Inventory Reserved
    event: fulfilment/inventory-reserved
    next_step:
      id: authorize_payment
      label: Step 2 — take payment
  - id: inventory_unavailable
    title: Inventory Unavailable
    event: fulfilment/inventory-unavailable
    next_step:
      id: cancel_order_flow
      label: Abort checkout
  - id: authorize_payment
    title: Authorize Payment
    custom:
      title: Authorize Payment
      summary: 'Command: Authorize Payment'
    next_step:
      id: payment_api
      label: Charge the order total
  - id: payment_api
    title: Payment API
    service: Payment API
    next_step:
      id: payment_requested
      label: Queue the payment
  - id: payment_requested
    title: Payment Requested
    event: payments/payment-requested
    next_step:
      id: fraud_api
      label: Screen for fraud
  - id: fraud_api
    title: Fraud Screening
    summary: A third-party fraud service scores the payment before any money moves.
    service: Fraud API
    next_steps:
      - id: fraud_check_passed
        label: Low risk
      - id: fraud_check_failed
        label: High risk
  - id: fraud_check_failed
    title: Fraud Check Failed
    event: payments/fraud-check-failed
    next_step:
      id: cancel_order_flow
      label: Block and abort
  - id: fraud_check_passed
    title: Fraud Check Passed
    event: payments/fraud-check-passed
    next_step:
      id: stripe_payments_api
      label: Charge card
  - id: stripe_payments_api
    title: Stripe
    service: Payments API
    next_step:
      id: stripe_webhook_endpoint
      label: Result via webhook
  - id: stripe_webhook_endpoint
    title: Stripe Webhook Endpoint
    service: Webhook Endpoint
    next_steps:
      - id: payment_succeeded
        label: Card charged
      - id: payment_failed
        label: Card declined
  - id: payment_failed
    title: Payment Failed
    event: payments/payment-failed
    next_step:
      id: cancel_order_flow
      label: Abort checkout
  - id: payment_succeeded
    title: Payment Succeeded
    event: payments/payment-succeeded
    next_steps:
      - id: create_order
        label: Step 3 — create the order
      - id: ledger_exporter
        label: Book the revenue
  - id: ledger_exporter
    title: Ledger Exporter
    summary: Posts the payment to the finance ledger for reporting and reconciliation.
    service: Ledger Exporter
  - id: cancel_order_flow
    title: Order Cancellation
    summary: Releases held stock, voids any payment and tells the customer. Click to expand the sub-flow.
    custom:
      title: Order Cancellation
      summary: 'Flow: Order Cancellation'
    next_step:
      id: order_not_placed
      label: Checkout aborted
  - id: order_not_placed
    title: Order not placed
    custom:
      title: Order not placed
      summary: Checkout was aborted and every earlier step compensated. The shopper keeps their basket and can try again.
  - id: create_order
    title: Create Order
    custom:
      title: Create Order
      summary: 'Command: Create Order'
    next_step:
      id: order_service
      label: Persist the order
  - id: order_service
    title: Order Service
    service: Order Service
    next_step:
      id: order_confirmed
      label: Order placed
  - id: order_confirmed
    title: Order Confirmed
    summary: The moment the sale is real. Three domains react to it in parallel.
    event: ordering/order-confirmed
    next_steps:
      - id: loyalty_service_award
        label: Award points
      - id: notification_service_confirm
        label: Email confirmation
      - id: warehouse_service
        label: Start fulfilment
  - id: loyalty_service_award
    title: Loyalty Service
    service: Loyalty Service
    next_step:
      id: loyalty_points_earned
      label: Points credited
  - id: loyalty_points_earned
    title: Loyalty Points Earned
    event: loyalty/loyalty-points-earned
  - id: notification_service_confirm
    title: Notification Service
    service: Notification Service
    next_step:
      id: customer_notified
      label: Confirmation sent
  - id: customer_notified
    title: Customer Notified
    event: notifications/customer-notified
  - id: warehouse_service
    title: Warehouse Service
    service: Warehouse Service
    next_step:
      id: picking_worker
      label: Create pick list
  - id: picking_worker
    title: Picking Worker
    service: Picking Worker
    next_step:
      id: order_packed
      label: Items boxed
  - id: order_packed
    title: Order Packed
    event: fulfilment/order-packed
    next_step:
      id: order_ready_for_shipping
      label: Ready at the dock
  - id: order_ready_for_shipping
    title: Order Ready For Shipping
    event: fulfilment/order-ready-for-shipping
    next_step:
      id: create_shipment
      label: Book a courier
  - id: create_shipment
    title: Create Shipment
    custom:
      title: Create Shipment
      summary: 'Command: Create Shipment'
    next_step:
      id: carrier_adapter
      label: Pick the cheapest carrier
  - id: carrier_adapter
    title: Carrier Adapter
    service: Carrier Adapter
    next_step:
      id: carrier_tracking_api
      label: Parcel handed over
  - id: carrier_tracking_api
    title: Carrier Tracking
    summary: The external courier reports progress back to us.
    service: Tracking API
    next_step:
      id: shipment_created
      label: Tracking number issued
  - id: shipment_created
    title: Shipment Created
    event: fulfilment/shipment-created
    next_steps:
      - id: shipment_delivered
        label: Delivered
      - id: shipment_failed
        label: Delivery failed
  - id: shipment_failed
    title: Shipment Failed
    event: fulfilment/shipment-failed
    next_step:
      id: delivery_exception
      label: Needs a human
  - id: delivery_exception
    title: Delivery exception
    custom:
      title: Delivery exception
      summary: The courier couldn't deliver. Support rebooks delivery or starts a refund.
    next_step:
      id: notification_service_delay
      label: Tell the customer
  - id: notification_service_delay
    title: Notification Service
    summary: Emails the customer that their parcel is delayed and what happens next.
    service: Notification Service
  - id: shipment_delivered
    title: Shipment Delivered
    event: fulfilment/shipment-delivered
    next_step:
      id: order_completed
      label: Close the order
  - id: order_completed
    title: Order Completed
    event: ordering/order-completed
    next_steps:
      - id: order_delivered
        label: Happy path
      - id: submit_review
        label: Customer reviews it
      - id: request_return
        label: Customer sends it back
  - id: order_delivered
    title: Order delivered
    custom:
      title: Order delivered
      summary: The parcel is at the customer's door, the payment is booked and loyalty points are credited.
  - id: submit_review
    title: Submit Review
    custom:
      title: Submit Review
      summary: 'Command: Submit Review'
    next_step:
      id: review_api
      label: Rate the product
  - id: review_api
    title: Review API
    service: Review API
    next_step:
      id: review_submitted
      label: Queued for moderation
  - id: review_submitted
    title: Review Submitted
    event: reviews/review-submitted
    next_step:
      id: rating_aggregator
      label: Recalculate stars
  - id: rating_aggregator
    title: Rating Aggregator
    service: Rating Aggregator
    next_step:
      id: rating_updated
      label: New average
  - id: rating_updated
    title: Rating Updated
    event: reviews/rating-updated
  - id: request_return
    title: Request Return
    custom:
      title: Request Return
      summary: 'Command: Request Return'
    next_step:
      id: returns_api
      label: Start a return
  - id: returns_api
    title: Returns API
    service: Returns API
    next_step:
      id: return_requested
      label: Return label issued
  - id: return_requested
    title: Return Requested
    event: returns/return-requested
    next_step:
      id: returns_processor
      label: Parcel comes back
  - id: returns_processor
    title: Returns Processor
    service: Returns Processor
    next_step:
      id: return_approved
      label: Item inspected
  - id: return_approved
    title: Return Approved
    event: returns/return-approved
    next_step:
      id: payment_worker_refund
      label: Refund the customer
  - id: payment_worker_refund
    title: Payment Worker
    service: Payment Worker
    next_step:
      id: refund_requested
      label: Issue refund
  - id: refund_requested
    title: Refund Requested
    event: payments/refund-requested
    next_step:
      id: stripe_refund
      label: Refund the card
  - id: stripe_refund
    title: Stripe
    service: Payments API
    next_step:
      id: refund_processed
      label: Money returned
  - id: refund_processed
    title: Refund Processed
    event: payments/refund-processed
    next_step:
      id: loyalty_service_reverse
      label: Take back points
  - id: loyalty_service_reverse
    title: Loyalty Service
    service: Loyalty Service
    next_step:
      id: loyalty_points_reversed
      label: Points removed
  - id: loyalty_points_reversed
    title: Loyalty Points Reversed
    event: loyalty/loyalty-points-reversed
    next_step:
      id: return_complete
      label: Return closed
  - id: return_complete
    title: Return complete
    custom:
      title: Return complete
      summary: The item is back in the warehouse, the customer is refunded and their loyalty points are reversed.
---

## Overview

**Order to Doorstep** follows a single order across the whole business — from a shopper searching the catalog to the parcel arriving at their door. It's the best flow in this catalog for seeing how the domains fit together:

| Domain         | What it does in this flow                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Shopping**   | Holds the basket and applies promotions                                                                         |
| **Catalog**    | Search and live product prices                                                                                  |
| **Customer**   | Signs the shopper in, awards loyalty points and sends emails (the **Loyalty** and **Notifications** subdomains) |
| **Ordering**   | Runs the checkout saga and owns the order                                                                       |
| **Payments**   | Fraud screening, charging the card via Stripe and booking revenue                                               |
| **Fulfilment** | Stock, picking, packing, shipping — and the **Returns** subdomain                                               |
| **Reviews**    | Ratings once the order arrives                                                                                  |

## Try it

- **Group by** (top right) — group the steps by **Domain**, **System**, **Team** or **Domain › System** to see where work hands over between teams. Switch between **Boxes** and **Lanes**.
- **Walk through** (bottom left) — step through the order one hop at a time. At each branch, pick what happens next: in stock or out of stock, card charged or declined, delivered or failed, reviewed or returned.
- **Order Cancellation** is a sub-flow — click it to expand the compensation steps in place.

## Paths through the flow

1. **Happy path** — search, basket, sign in, price, reserve stock, pass fraud checks, charge the card, create the order, then loyalty, email and fulfilment run in parallel until the parcel is delivered.
2. **Checkout aborted** — out of stock, high fraud risk or a declined card all hand over to the [[flow|ordering-platform/order-cancellation]] sub-flow.
3. **Delivery exception** — the courier fails to deliver and support takes over.
4. **Review** — the customer rates the product and the average rating updates.
5. **Return** — the item comes back, the card is refunded and loyalty points are reversed.
