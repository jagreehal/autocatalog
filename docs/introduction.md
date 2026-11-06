---
title: Introduction
owner: Maintainers
summary: A catalog of your events, services and docs, read from the repositories you have, with nothing to set up.
tags:
  - overview
related:
  - docs/quick-start
  - docs/comparison
---

You already wrote the catalog. It sits in the schemas your services validate
against, the producers and consumers those schemas name, the owners in
CODEOWNERS and the Markdown beside your code. autocatalog reads all of it where
it lives, so you skip the setup a catalog usually asks for:

- **Setup:** one JSON Schema and one Markdown page gave us a 24-page site in 13
  seconds, from one command and no config file, once `npx` has downloaded it.
- **Install:** `npx autocatalog site . --dev` runs it and leaves your repository
  as it was.
- **Upkeep:** you write no service definitions or catalog entries. Each build
  reads your contracts again, so the site follows them.
- **Hosting:** the site is a static folder that any host can serve.
- **Joining:** a team adds a GitHub topic, and one action checks its pull
  requests.

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

## Where it fits

Autocatalog derives a static site from your repositories. It has no plugin
pipeline, no resource-type system to extend, and no server. To author a catalog
with custom pages and a wider set of resource types, or to run both tools
together, read [autocatalog and EventCatalog](/docs/comparison).

Everything here is MIT, including the MCP server and every other agent surface,
with no licence key and no plan.

Node.js 24 or newer. Python 3.11 or newer for the Pydantic extractor.

## Next

- [Quick start](/docs/quick-start) — a running catalog from one command
- [Zod](/docs/events/zod) · [Pydantic](/docs/events/pydantic) · [JSON Schema](/docs/events/json-schema) — the three ways in
- [Drift gating in CI](/docs/drift-ci) — where the catalog starts paying for itself
