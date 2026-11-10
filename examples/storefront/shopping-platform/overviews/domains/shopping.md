---
name: Shopping
summary: The Shopping domain owns the customer's path to purchase — building a cart, applying promotions, and checking out. It coordinates the cart and the discounts that apply to it.
owner: shopping-platform
---

## Overview

The **Shopping** domain is responsible for everything between browsing and buying — the shopping cart and the promotions applied to it. It is split into two systems:

### How the systems work together

The **Cart System** owns the customer's cart and the checkout flow. When pricing a cart, it asks the **Promotion System** to calculate the discounts that apply. When the customer checks out, the Cart System publishes an event the rest of the business reacts to.

## System Diagram

The systems in this domain, how they relate, and the people who interact with them.
