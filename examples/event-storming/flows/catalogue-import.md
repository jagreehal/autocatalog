---
title: Catalogue import
summary: A supplier's product file becomes products in the catalogue, or a list of what went wrong.
entity: import
field: status
steps:
  - id: request
    stage: Request import
    actor: { name: Supplier user, summary: uploads a catalogue file in the app }
    command: { name: Run catalogue import, summary: import id and email }
    systems:
      - { name: Job queue, summary: the catalogue import task }
    next_step: load

  - id: load
    stage: Load import record
    title: Import loaded
    systems: [Database]
    decidedBy: Import
    code: [{ file: src/import.ts, contains: loadImport }]
    next_steps:
      - resolve
      - { id: import-not-found, label: no import has that id }

  - id: import-not-found
    title: Import not found
    code: [{ file: src/import.ts, contains: ImportNotFound }]

  - id: resolve
    stage: Resolve supplier
    title: Supplier resolved
    systems: [Database]
    decidedBy: Supplier
    code: [{ file: src/import.ts, contains: resolveSupplier }]
    next_steps:
      - download
      - { id: supplier-not-found, label: no supplier has that id }

  - id: supplier-not-found
    title: Supplier not found
    code: [{ file: src/import.ts, contains: SupplierNotFound }]

  - id: download
    stage: Download file
    title: Catalogue file downloaded
    command: Download catalogue file
    systems:
      - { name: Object storage, summary: the file at the import's key }
    decidedBy: Import
    code: [{ file: src/import.ts, contains: downloadFile }]
    next_steps:
      - parse
      - { id: file-missing, label: nothing at that key }

  - id: file-missing
    title: Catalogue file missing
    summary: No key, no bucket, or nothing at that location.
    policy: Whenever the file can't be fetched, fail the import
    code: [{ file: src/import.ts, contains: FileMissing }]
    next_step: errored

  - id: parse
    stage: Parse file
    title: Catalogue file parsed
    summary: Products, and the rows that would not parse.
    command: Parse catalogue file
    systems:
      - { name: Feed parser, summary: shared parsing library }
    decidedBy: Catalogue file
    policy: Whenever the file is parsed, ingest every product
    code: [{ file: src/import.ts, contains: parseFile }]
    next_steps:
      - ingest
      - { id: file-unreadable, label: the parser gives up }

  - id: file-unreadable
    title: Catalogue file unreadable
    policy: Whenever it can't be parsed, fail the import
    code: [{ file: src/import.ts, contains: FileUnreadable }]
    next_step: errored

  - id: ingest
    stage: Ingest each product
    title: Product created or updated
    command: Ingest product
    repeats: once per parsed product
    flow: ingest-product
    systems:
      - { name: Database, summary: products and prices }
    decidedBy: Product
    code: [{ file: src/import.ts, contains: ingestProduct }]
    next_steps:
      - progress
      - { id: product-failed, label: a product fails }
      - { id: outside-region, label: the product is outside the sales region }

  - id: product-failed
    title: Product ingest failed
    summary: Records the title, SKU and reason.
    policy: Whenever a product fails, record it and carry on with the next one
    code: [{ file: src/import.ts, contains: ProductIngestFailed }]
    next_step: progress

  - id: outside-region
    title: Product outside sales region
    summary: Thrown, so it is counted as a failed product.
    code: [{ file: src/import.ts, contains: OutsideSalesRegion }]
    next_step: progress

  - id: progress
    stage: Ingest each product
    title: Import progress recorded
    summary: Every 100 products.
    policy: Every 100 products, save progress
    next_steps:
      - completed
      - { id: partial, label: at least one error was recorded }
      - { id: status-save-failed, label: saving the final status fails }

  - id: completed
    stage: Finish import
    title: Catalogue import completed
    summary: No errors.
    command: Finish import
    decidedBy: Import
    transition: { from: running, to: complete }
    readModels:
      - { name: Import status screen, summary: 'status, products imported, error list' }
      - { name: Notifications, summary: in-app and email }
    policy:
      - Whenever the import finishes, notify the user
      - Always save the final status

  - id: partial
    stage: Finish import
    track: happy
    title: Catalogue import partially completed
    summary: At least one error was recorded.
    transition: { from: running, to: complete }
    policy: Whenever the import finishes, notify the user

  - id: errored
    stage: Finish import
    title: Catalogue import errored
    summary: The file was missing or unreadable, or something else went wrong.
    transition: { from: running, to: errored }
    policy: Whenever the import finishes, notify the user

  - id: status-save-failed
    stage: Finish import
    title: Import status save failed
    summary: Only logged.

scenarios:
  - given: A valid file with new products
    when: The import runs
    then: Products are created, the status is complete, and the user is told how many were imported
    step: completed
  - given: The same file is imported again
    when: The import runs
    then: Products are updated, not duplicated
    step: completed
  - given: A file where one product fails
    when: The import runs
    then: The other products are imported, and the email lists the failed product's title and SKU
    step: partial
  - given: No file at the import's key
    when: The import runs
    then: The status is errored and the user is told
    step: errored
  - given: The import's supplier has been deleted
    when: The import runs
    then: Nothing visible happens
    expected: Decided under the missing import or supplier hotspot
    step: supplier-not-found
  - given: A sales region set on the import, and some products outside it
    when: The import runs
    then: Those products are counted as errors
    expected: Decided under the outside-region hotspot
    step: outside-region
---

Storming the import code produced this board. Every fact is something that
happened and can't be undone; each failure needs a policy that says what
happens next.
