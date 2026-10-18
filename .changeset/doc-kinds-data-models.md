---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-core': minor
---

Document kinds and data model pages. ADRs, runbooks and incidents live in each repository's `docs/`, and a company adds or changes kinds in one `contracts/autocatalog.conventions.json`. `ac docs check` validates each kind, `ac docs init-conventions` writes the defaults, and the site gives each kind an index page and lists them on the services and events they apply to. Prisma, Drizzle and Mongoose models get pages with fields, relations, indexes and an ER diagram, and `ac site` reads them with no setup.
