---
name: Import
summary: One run of a supplier's catalogue file into the catalogue.
identifier: importId
properties:
  - { name: importId, type: string, required: true }
lifecycles:
  status:
    states: [running, complete, errored]
    initial: running
    terminal: [complete, errored]
---
