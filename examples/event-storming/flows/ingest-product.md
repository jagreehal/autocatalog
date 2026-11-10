---
title: Ingest a product
summary: What happens to each parsed product, in order. A step that throws fails the product, and the import moves on to the next.
entity: product
steps:
  - id: check-region
    stage: Check sales region
    title: Product in sales region
    summary: Only when the import sets a sales region.
    code: [{ file: src/import.ts, contains: checkRegion }]
    next_steps:
      - find
      - { id: outside-region, label: outside the region }

  - id: outside-region
    title: Product outside sales region
    summary: Thrown, so it is counted as a failed product.
    next_step: product-failed

  - id: find
    stage: Find existing product
    title: Existing product matched
    summary: Matched on supplier and the supplier's SKU.
    decidedBy: Product
    next_steps:
      - details
      - { id: started, label: no match }
      - { id: lookup-failed, label: the database fails }

  - id: started
    stage: Find existing product
    track: happy
    title: New product started
    next_step: details

  - id: lookup-failed
    title: Product lookup failed
    summary: Database error.
    next_step: product-failed

  - id: details
    stage: Set product details
    title: Product details set
    summary: Title, barcode, category, language, images. Resets the price list.
    next_step: prices

  - id: prices
    stage: Build price list
    title: Price list built
    summary: Turns the file's price rows into one price per region.
    next_steps:
      - save
      - { id: invalid-region, label: a price names a region that does not exist }

  - id: invalid-region
    title: Invalid region code found
    summary: Recorded as an error, but the product is still saved.
    policy: Whenever a region code is invalid, record it and save the product
    next_step: save

  - id: save
    stage: Save product
    title: Product saved
    next_steps:
      - { id: product-failed, label: saving fails }

  - id: product-failed
    track: failure
    title: Product ingest failed
    summary: Records the title, SKU and reason.
    policy: Whenever a product fails, record it and carry on with the next one
---
