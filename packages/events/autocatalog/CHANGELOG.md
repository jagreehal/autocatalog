# autocatalog

## 0.2.0

### Minor Changes

- 63029e8: Service repositories with an API and their own models.

  - `ac drift` and `ac check` compare a `$ref` with the keywords beside it as one schema, and read `unevaluatedProperties` and `unevaluatedItems` where they apply.
  - The resource scan reads Mongoose models in object literals, in functions and under another name for `model`, and prints the file and line of each call it skips. `exportMongooseModels` takes `access` and `service`.
  - A repository's service serves a spec that names none. Endpoints take the owner in `docs/meta.json`, as do collections and tables that only the owner's services use.
  - `ac site` builds beside Express in a pnpm project, and a site's code and extensions get the dependency versions they name. `"llms": true` lists a server site's documents in `llms.txt`.
  - The home page counts each fact by its source, the domain map draws domains with a page, and a map keeps the zoom its reader gave it.
  - `autocatalog` installs the site builder. Install `autocatalog-cli` alone for CI checks.

### Patch Changes

- Updated dependencies [63029e8]
  - autocatalog-cli@0.15.0
  - autocatalog-docs-astro@0.18.0

## 0.1.19

### Patch Changes

- autocatalog-cli@0.14.1

## 0.1.18

### Patch Changes

- Updated dependencies [75a8ff7]
  - autocatalog-cli@0.14.0

## 0.1.17

### Patch Changes

- autocatalog-cli@0.13.1

## 0.1.16

### Patch Changes

- Updated dependencies [9451b43]
  - autocatalog-cli@0.13.0

## 0.1.15

### Patch Changes

- Updated dependencies [ac55524]
- Updated dependencies [8258ffd]
- Updated dependencies [b517a68]
  - autocatalog-cli@0.12.0

## 0.1.14

### Patch Changes

- Updated dependencies [ab0b648]
  - autocatalog-cli@0.11.0

## 0.1.13

### Patch Changes

- Updated dependencies [f5c7ed5]
  - autocatalog-cli@0.10.0

## 0.1.12

### Patch Changes

- Updated dependencies [95f623d]
  - autocatalog-cli@0.9.0

## 0.1.11

### Patch Changes

- Updated dependencies [ffa29c9]
  - autocatalog-cli@0.8.0

## 0.1.10

### Patch Changes

- Updated dependencies [80c26b1]
  - autocatalog-cli@0.7.0

## 0.1.9

### Patch Changes

- Updated dependencies [80cb2b2]
  - autocatalog-cli@0.6.2

## 0.1.8

### Patch Changes

- autocatalog-cli@0.6.1

## 0.1.7

### Patch Changes

- Updated dependencies [bb5e41e]
  - autocatalog-cli@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [3968aaa]
- Updated dependencies [96719f9]
  - autocatalog-cli@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [5cd0cb5]
  - autocatalog-cli@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [acf1994]
  - autocatalog-cli@0.3.1

## 0.1.3

### Patch Changes

- Updated dependencies [e58430a]
  - autocatalog-cli@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [1b03b64]
  - autocatalog-cli@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [98b459d]
  - autocatalog-cli@0.2.0

## 0.1.0

### Minor Changes

- 8ffcbf6: First public release.

  autocatalog reads the event contracts your repositories already hold (Zod, Pydantic, JSON Schema, OpenAPI, AsyncAPI, Avro, protobuf) and writes them into a catalog you commit beside the code. Each field records whether you declared it, the scanner extracted it, or the scanner inferred it.

  - `autocatalog` and `autocatalog-cli` give you the `ac` command. `ac scan` builds the catalog, `ac validate` and `ac health` check it, and `ac drift --base-ref origin/main` fails a pull request that breaks a consumer, a delivery promise or another team's datastore.
  - `autocatalog-core` holds the catalog model, the loaders, the resource graph and the drift rules. It validates each schema in the JSON Schema dialect the schema declares. A scan on Windows records the same forward-slash paths as one on macOS or Linux, so CODEOWNERS matches and the committed catalog doesn't change between machines.
  - `autocatalog-adapter-zod` turns Zod schemas into catalog events with `defineEvent`.
  - `autocatalog-mcp` lets AI agents query the catalog over MCP.
  - `autocatalog-docs-core` and `autocatalog-docs-astro` build one Starlight site across every repository you enrol, with pages for events, services, owners and fields.
  - `autocatalog-agents-core`, `autocatalog-agents-cli`, `autocatalog-agents-mcp` and `autocatalog-agents-adapter-autotel` catalog AI agents, their tools, models and policies, and check them against autotel traces.

  If your team runs EventCatalog, you keep it. `ac from-eventcatalog` imports your events, commands, queries, services, datastores, owners and systems. `ac to-eventcatalog` writes them back through EventCatalog's MIT SDK, and a second import gives back the same files. Your portal stays in EventCatalog while `ac drift` gates the pull requests. `ac site --eventcatalog` can also frame EventCatalog's diagrams inside the autocatalog site.

### Patch Changes

- Updated dependencies [8ffcbf6]
  - autocatalog-cli@0.1.0
