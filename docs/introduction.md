---
title: Introduction
owner: Maintainers
summary: One provenance-aware catalog, discovered by convention from the repositories you already have.
tags:
  - overview
related:
  - docs/quick-start
  - docs/comparison
---

The knowledge that describes your systems already exists. It is in the schemas
your services validate against, the producers and consumers named in that
metadata, and the markdown someone committed next to the code. What is missing is
not documentation — it is one place that reads all of it, and can say where every
statement came from.

That is what autocatalog is. You point it at a repository, not at a docs folder.

## The bet

**Discovery is by convention, not configuration.** Schemas in the repository,
prose in `docs/`. There is no pipeline to assemble and no list of generators to
keep current, so enrolling a repository is committing to a convention rather than
editing a config file somewhere else.

**There is no second model to maintain.** The catalog is generated state. Nobody
updates it in a pull request, which means nobody can forget to.

**Everything derived says where it came from.** Every field carries its
provenance — `declared` by a person, `extracted` from code, or `inferred` — and
links to the source that produced it. Where identity or meaning cannot be
established, the field is marked `needsReview` instead of being filled in with
something plausible. Automation earns trust by being inspectable, not by being
confident.

**Overrides sit on top of generated state, never underneath it.** Write
narrative in an event's `index.mdx` and it renders beside the generated fields
without changing them. Regeneration leaves it alone.

## What that gives you

Define an event once — in Zod, in Pydantic, or as a JSON Schema file — and the
following are derived rather than authored:

- **Event pages** with a schema tree, examples, version diffs and code snippets
- **Service pages** built from the `producers` and `consumers` on your events
- **An architecture graph**, producer → event → consumer, filterable by domain
- **Search**, full-text and by attribute
- **MCP tools**, so a coding agent queries the catalog instead of being handed a
  summary of it
- **A CI gate** that fails the pull request breaking a consumer, and names the
  consumers it breaks

You never write a service definition. When two events name the same producer, the
service page is the union of both.

## Prose, on the same terms

The convention applies to writing as well as to schemas. A repository publishes
documentation by committing markdown to `docs/`; one site reads every enrolled
repository. `owner` is required frontmatter, freshness comes from git rather than
from a date someone typed, and backlinks are derived. This site is that mechanism
running on this repository. See [the docs convention](/docs/docs-convention).

## What it is not

It is not a place to assemble a bespoke internal portal. There is no plugin
pipeline, no resource-type system to extend, and no server. If you need a catalog
that hosts dashboards and custom API routes, or twenty resource types, read
[choosing between autocatalog and EventCatalog](/docs/comparison) — that page is
honest about where the other tool is the better answer.

Everything here is MIT, including the MCP server and every other agent surface.
No licence key, no plan, no telemetry. Opting into EventCatalog's diagrams with
`ac site --eventcatalog` runs EventCatalog's build, which reports usage to
EventCatalog.

Node.js 24 or newer. Python 3.11 or newer for the Pydantic extractor.

## Next

- [Quick start](/docs/quick-start) — a running catalog in under a minute
- [Zod](/docs/events/zod) · [Pydantic](/docs/events/pydantic) · [JSON Schema](/docs/events/json-schema) — the three ways in
- [Drift gating in CI](/docs/drift-ci) — where the catalog starts paying for itself
