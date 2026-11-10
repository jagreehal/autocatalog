---
name: Search API
summary: Public-facing API that serves fast, relevant product search to the rest of the business, reading from the search index.
owner: search-platform
---

## Overview

The **Search API** is the front door to the Search System. It answers [[event|catalog/search-products]] queries by reading from the **Search Index**, which is kept current by the [[service|Search Indexer]]. Other teams use this API so they never have to query the catalog database directly.

### Responsibilities

| Area   | Description                                                                                  |
| ------ | -------------------------------------------------------------------------------------------- |
| Search | Serves [[event\|catalog/search-products]] with full-text matching, filtering and pagination. |
| Reads  | Queries the **Search Index** — never the catalog database.                                   |
