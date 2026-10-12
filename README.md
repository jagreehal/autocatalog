# autocatalog

autocatalog finds the event contracts, documentation and agents your
repositories already own, checks them in CI, and publishes one company site for
people and agents. Point it at Zod, Pydantic, JSON Schema, OpenAPI, AsyncAPI, Avro
or protobuf. Each derived field records where it came from, and a CI gate fails
the pull request that breaks a consumer.

[Brownfield discovery](docs/brownfield-resources.md) adds Mongoose, Prisma and Drizzle datastore contracts, commands, trace-inferred architecture, existing ownership catalogs, schema registries and CloudEvents envelopes.

The site is [Starlight](https://starlight.astro.build). For interactive
architecture diagrams, autocatalog writes the same catalog into
[EventCatalog](https://www.eventcatalog.dev).

**[Documentation →](https://jagreehal.github.io/autocatalog)** — the site is built
from the `docs/` folder in this repository, using the plugin this repository ships.

## Start on your own repository

With event contracts in `contracts/` (JSON Schema, OpenAPI, Avro or protobuf)
and markdown in `docs/`:

```bash
npx autocatalog site . --dev
```

Nothing authored, nothing configured, nothing written into the repository.
Contracts somewhere else, or in Zod? `npx autocatalog .` scans the whole
repository into `events/`, which you commit. In CI,
`npx autocatalog drift --base-ref origin/main --root .` fails the pull request
that breaks a consumer. The [quick start](docs/quick-start.md) says when you
need each.

Then build one site across every repository your company enrols:

```bash
npx autocatalog site --topic catalog --owner acme
```

A team enrols its repository by adding the `catalog` topic on GitHub.

## Free, and works with EventCatalog

EventCatalog draws the best event diagrams around. autocatalog does the work
around them, and several of those jobs sit behind EventCatalog's paid plans:

| Job                                         | EventCatalog | autocatalog                             |
| ------------------------------------------- | ------------ | --------------------------------------- |
| Generate the catalog from OpenAPI, AsyncAPI | Scale plan   | `ac scan`, free                         |
| Fail CI when a change breaks a consumer     | Scale plan   | `ac drift --base-ref origin/main`, free |
| Field explorer across every schema          | Scale plan   | `/fields` and `ac fields`, free         |
| MCP server for AI agents                    | Scale plan   | `autocatalog-mcp`, free                 |
| Documentation pages beside the catalog      | Starter plan | The docs convention and `ac site`, free |

`ac to-eventcatalog` writes the catalog into an EventCatalog project through
EventCatalog's MIT-licensed SDK, and `ac from-eventcatalog` reads one back. Use
EventCatalog for the pictures; autocatalog keeps them true.

## The schema is the catalog

There is no catalog model to maintain beside your code. autocatalog reads the contract from your schemas and stores what it extracted as generated state, tagged with where each field came from — `declared`, `extracted`, or `inferred`. Narrative content layers on top and survives regeneration; it is never the foundation.

**Author in Zod or Pydantic** (or drop JSON Schema / OpenAPI / AsyncAPI). **The catalog speaks JSON Schema** — every language adapter emits the same on-disk interchange (`schema.json`). That is the wire contract, not a full runtime validator: Zod refinements and transforms that do not survive JSON Schema are out of scope for the catalog.

Define an event once. The catalog, the graph, the services all derive from it.

Zod:

```ts
import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

export const PaymentCompleted = defineEvent(
  {
    domain: 'payments',
    team: 'Billing',
    producers: ['PaymentService'],
    consumers: ['LedgerService', 'NotificationService'],
    tags: ['pci'],
  },
  z.object({
    id: z.string(),
    amount: z.number(),
  }),
);
```

Run `ac from-zod ./src/events.ts`. From that one file you get:

- **Event page** — schema viewer, examples, version history, code snippets
- **Service pages** — `PaymentService` and `LedgerService` pages auto-generated showing what each produces and consumes
- **Architecture graph** — interactive producer→event→consumer graph with domain filtering
- **Search** — command palette, full-text, find by attribute
- **MCP tools** — AI coding agents can query events, schemas, and examples

`defineEvent` returns the Zod schema unchanged. `z.infer`, `.parse()`, `.safeParse()` all work. The metadata lives on a symbol. The adapter finds it during extraction.

Pydantic:

```python
from pydantic import BaseModel, ConfigDict

class PaymentCompleted(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "autocatalog": {
                "id": "payment.completed",
                "version": "1.0.0",
                "name": "Payment Completed",
                "summary": "Fires when a payment completes",
                "domain": "payments",
                "team": "Billing",
                "producers": ["PaymentService"],
            }
        }
    )
    id: str
    amount: float
```

`autocatalog-py extract --module myapp.events` — same result. Same graph. Same services.

## What you get from one schema definition

- An event page with the schema as a tree, examples, and where the contract was
  found
- Service pages, derived from each event's producers and consumers
- A field index across every event, with the services each field reaches
- Search, navigation and dark mode from Starlight
- An MCP server and a JSON Schema URL per event, for agents
- Validation and drift checks for CI

You never create a service definition. When two events declare the same
producer, autocatalog builds the service page from the union of both.

## AI coding agents

```json
{
  "mcpServers": {
    "autocatalog": {
      "command": "node",
      "args": ["node_modules/autocatalog-mcp/dist/index.js", "--root", "."]
    }
  }
}
```

Eleven tools: list events, describe event, get schema, get examples, search, find by attribute, search fields, LLM text, assess impact, check change, and catalog status.

## Ways to add events

| Approach                  | What you write                         | Result                                                      |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Zod + `defineEvent()`     | Schema in code                         | Auto-extracted → JSON Schema catalog                        |
| Pydantic + `model_config` | Model in code                          | Same interchange, from Python                               |
| Raw JSON Schema files     | `*.json` / `*.schema.json` in the repo | `ac scan` discovers them (sidecar or `x-autocatalog` meta)  |
| OpenAPI 3.x               | `openapi.yaml` in the repo             | `ac scan` reads webhooks, callbacks and opted-in operations |
| Avro / protobuf           | `*.avsc` / `*.proto` in the repo       | `ac scan` reads them with wire-format semantics intact      |
| Existing JSON Schema      | `ac import --github-repo`              | Import schema/examples into catalog state                   |
| AsyncAPI / EventCatalog   | Spec or markdown catalog               | `ac from-asyncapi` / `ac from-eventcatalog`                 |
| Manual override           | Optional `index.mdx` body              | Narrative without changing generated data                   |

`ac scan` runs passive discovery adapters, resolves duplicate claims by provenance and confidence, and transactionally publishes one complete catalog artifact. A failed adapter or invalid event leaves the previous catalog untouched. Runtime adapters such as Zod execute repository code, so they require explicit consent: `ac scan . --allow-code-execution`.

## Daily commands

One binary covers events, documentation and agents:

```
npx autocatalog site . --dev   Serve this repository's site — the first thing to run
npx autocatalog .   Scan this repository into events/, to commit
ac scan          Safely discover JSON Schema, OpenAPI, Avro and protobuf events
ac scan --allow-code-execution   Include trusted runtime adapters such as Zod
ac site          Build one site from every enrolled repository
ac validate      Check all events
ac fields        Which events carry a field, and who it reaches
ac drift --base-ref origin/main   Scan both Git states and gate contract drift
ac docs check    Validate repository-owned documentation
ac agents audit  Audit an agent catalog (optional autocatalog-agents-cli)
ac import        Import from GitHub
ac to-eventcatalog  Write the catalog into an EventCatalog project
```

Adapters auto-discover from `node_modules`. JSON Schema, OpenAPI, Avro and Protobuf are built in — `ac scan` runs them with no install. An adapter can add a dedicated command, participate directly in `ac scan`, or both.

To add a new source format, implement the discovery interface and advertise it from the adapter package. See [writing your own adapter](docs/events/json-schema.md#writing-your-own-adapter).

Each candidate keeps its event and source evidence together. Core owns conflict resolution, enrichment, validation, stale cleanup, and publication; adapters only translate their source format into the shared JSON Schema IR.

See [production operation](docs/production.md) for the trust model, integrity checks, crash recovery, Git-ref constraints, and release gate.

## The site

- **`/`** lists every document by repository, with owner and last change
- **`/events/payments-service/payments/payment.completed/`** shows one event, and
  `schema.json` beside it
  holds the contract
- **`/services/PaymentService/`** lists what one service produces and consumes
- **`/fields`** indexes every field across every event, with conflicts and reach
- **`/catalog`** and **`/catalog.json`** hold the whole knowledge graph

See [the company site](docs/site.md) for flags and a GitHub Pages workflow.

## Packages

```
packages/events/autocatalog   The one package users install: npx autocatalog
packages/events/core          Schemas, loader, writer, scanners, drift, snippets, llm
packages/events/cli           ac CLI: scan, site, drift, EventCatalog export and import
packages/events/adapter-zod   defineEvent(), Zod → JSON Schema → catalog
packages/events/mcp           MCP server, 12 tools, stdio transport
packages/docs/core            docs/ aggregation, frontmatter contract, git dates, backlinks
packages/docs/astro           The Starlight site: docs, events, services, fields, .md twins
skills                        Agent skills (npx skills add jagreehal/autocatalog)
python/autocatalog-py         Pydantic extractor
```

## Documentation, same convention

The same idea applied to prose: every team commits Markdown to `docs/` in its own
repository, and one site aggregates them. Ownership and freshness are facts —
`owner` is required frontmatter, `updated` comes from git — and links across
repositories are declared as ids, so they resolve in a standalone clone.

The site is [Starlight](https://starlight.astro.build) with a plugin, so search,
navigation and accessibility are not ours to get wrong; only where the documents
come from, and what can be said about them, is.

The frontmatter contract is a committed JSON Schema the organisation owns, found
at `contracts/docs-frontmatter.json` without a flag. Add a field to it and the
same declaration validates in CI, reaches the page, and can be enforced from
Python.

```bash
ac docs init-schema # write the default contract, then edit it in place
ac docs check       # frontmatter, cross-repo links, deleted-but-linked docs
ac docs sync-schema # has this repo's copy of the contract drifted from upstream?
ac docs manifest    # publish contracts/docs-manifest.json
pnpm site:docs:dev  # the aggregated, many-repository shape: examples/docs-demo
pnpm docs:dev       # the single-repository shape: this project's own site
```

This project's documentation site is the convention running on itself. The pages
under `docs/` are validated by `ac docs check` in CI, published to GitHub Pages
from `apps/docs`, and every page has a `.md` twin and an entry in `llms.txt`.
