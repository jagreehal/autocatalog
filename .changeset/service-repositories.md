---
'autocatalog': minor
'autocatalog-cli': minor
'autocatalog-core': minor
'autocatalog-docs-astro': minor
'autocatalog-docs-core': minor
---

Service repositories with an API and their own models.

- `ac drift` and `ac check` compare a `$ref` with the keywords beside it as one schema, and read `unevaluatedProperties` and `unevaluatedItems` where they apply.
- The resource scan reads Mongoose models in object literals, in functions and under another name for `model`, and prints the file and line of each call it skips. `exportMongooseModels` takes `access` and `service`.
- A repository's service serves a spec that names none. Endpoints take the owner in `docs/meta.json`, as do collections and tables that only the owner's services use.
- `ac site` builds beside Express in a pnpm project, and a site's code and extensions get the dependency versions they name. `"llms": true` lists a server site's documents in `llms.txt`.
- The home page counts each fact by its source, the domain map draws domains with a page, and a map keeps the zoom its reader gave it.
- `autocatalog` installs the site builder. Install `autocatalog-cli` alone for CI checks.
