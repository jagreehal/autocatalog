---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-mcp': minor
'autocatalog-plugin-odcs': minor
---

ODCS data contracts.

- **Data product pages.** A data product whose output names an `*.odcs.yaml` contract shows it as the data's product details page: terms of use, service levels with their track record (from `<contract>.results.ndjson`, counting only that contract version, and only runs that checked every object and quality rule and measured every promise), columns, owner and support, access, and the AI context. An input may now name a contract too, which the page shows as what the product expects. Each contract version has its own card.
- **ODPS data products.** `<id>.odps.yaml` in the Open Data Product Standard v1, at the repository's root or in `data-products/`, is read beside the Markdown form. Its ports name contracts by `contractId` and exact `version`, so v1 and v2 publish side by side, and an input port links to the product that keeps its contract.
- **Agents.** `llms.txt` lists each data product's contracts with their service levels, limitations, instructions, constraints and verified questions. The new MCP tool `data_contract` returns the whole contract as written, each verified statement's query and each server's connection details included.
- **New plugin `autocatalog-plugin-odcs`.**
  - `ac from-odcs` writes the tables each contract declares into `.autocatalog/models.json`, so the scan publishes them as table resources. A server `schema` qualifies the table id. Naming contracts replaces only their tables. A failed run writes nothing. A contract or product without `status` reads, as ODCS and ODPS allow.
  - `--base` pairs contracts by id and major version, fails on a base contract that does not read or is declared twice, and fails a breaking change released under too small a version bump, or a contract removed before it was retired.
  - `--check` fails when the committed models are stale.
  - `--consumers <checkouts...>` checks other repositories' expected contracts and names the consumer a change breaks. A data product that does not read fails the run, as does an ODPS input pinned to a contract version no data product publishes.
- **Core.** Core accepts `odcs` as a model adapter.
