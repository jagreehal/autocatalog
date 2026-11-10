---
name: Customer Notifications
summary: The Customer Notifications subdomain keeps customers informed. It listens to key moments across Ordering, Fulfilment, Payments, Reviews, Loyalty and Returns and sends the customer an email, SMS or push notification on their preferred channel.
owner: customer-platform
parent: customer
---

## Overview

The **Customer Notifications** subdomain is part of the [[domain|customer]] domain. It has no systems of its own — a single [[service|Notification Service]] consumes events from across the business and notifies customers according to their **Notification Preferences**.

| Source domain      | Events                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Ordering           | [[event\|ordering-platform/ordering/order-confirmed]]                                                                |
| Fulfilment         | [[event\|fulfilment-platform/fulfilment/shipment-delivered]], [[event\|fulfilment-platform/returns/return-approved]] |
| Payments           | [[event\|payments-platform/payments/payment-failed]], [[event\|payments-platform/payments/refund-processed]]         |
| Reviews            | [[event\|reviews-platform/reviews/review-published]]                                                                 |
| Customer (Loyalty) | [[event\|customer-platform/loyalty/loyalty-points-earned]]                                                           |
