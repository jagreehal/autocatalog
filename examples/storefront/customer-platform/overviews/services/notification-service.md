---
name: Notification Service
summary: Sends customers email, SMS and push notifications in response to events from across Acme Inc, honouring each customer's channel preferences.
owner: customer-platform
---

## Overview

The **Notification Service** is the single place Acme Inc talks to customers outside the storefront. It consumes events from other domains, looks up the customer's channel choices in **Notification Preferences**, sends the message and publishes [[event|customer-platform/notifications/customer-notified]].

### Notifications sent

| Event                                                        | Customer message                                       |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| [[event\|ordering-platform/ordering/order-confirmed]]        | Order confirmation with summary and delivery estimate. |
| [[event\|fulfilment-platform/fulfilment/shipment-delivered]] | Delivery confirmation.                                 |
| [[event\|payments-platform/payments/payment-failed]]         | Ask the customer to update their payment method.       |
| [[event\|payments-platform/payments/refund-processed]]       | Refund confirmation.                                   |
| [[event\|reviews-platform/reviews/review-published]]         | Let the reviewer know their review is live.            |
| [[event\|customer-platform/loyalty/loyalty-points-earned]]   | New points balance.                                    |
| [[event\|fulfilment-platform/returns/return-approved]]       | Return label and drop-off instructions.                |
