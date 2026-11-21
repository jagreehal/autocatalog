---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-mcp': minor
---

ODCS data contracts.

- **Data product pages.** A data product whose output names an `*.odcs.yaml` contract shows it as the data's product details page: terms of use, service levels with their track record (from `<contract>.results.ndjson`, counting only that contract version, and only runs that checked every object and quality rule and measured every promise), columns, owner and support, access, and the AI context. An input may now name a contract too, which the page shows as what the product expects. Each contract version has its own card.
- **ODPS data products.** `<id>.odps.yaml` in the Open Data Product Standard v1, at the repository's root or in `data-products/`, is read beside the Markdown form. Its ports name contracts by `contractId` and exact `version`, so v1 and v2 publish side by side, and an input port links to the product that keeps its contract.
- **Agents.** `llms.txt` lists each data product's contracts with their service levels, limitations, instructions, constraints and verified questions. The new MCP tool `data_contract` returns the whole contract as written, each verified statement's query and each server's connection details included.
- **Core.** Core accepts `odcs` as a model adapter.
