---
title: autocatalog and EventCatalog
owner: Maintainers
summary: How the two tools relate, what each one starts from, and how to run them together.
tags:
  - overview
related:
  - docs/introduction
  - docs/events/importing
---

[EventCatalog](https://www.eventcatalog.dev), created by David Boyne, set the
standard for documenting event-driven architectures. Autocatalog learned a lot
from it: the resource names, the visualiser, the way examples and channels are
laid out. Where autocatalog writes a file EventCatalog also reads, it uses
EventCatalog's format, so a catalog can move between the two.

The tools start from different places. Most teams can use one, the other, or
both.

## Two starting points

**EventCatalog starts from the catalog.** You build it as a project: Markdown
and MDX for each resource, generators that pull from OpenAPI, AsyncAPI and
schema registries, and an SDK for anything custom. You decide what goes in and
how it reads, and it supports a wide range of resource types.

**Autocatalog starts from your repositories.** Schemas in code or in
`contracts/`, Markdown in `docs/`, owners in CODEOWNERS. It reads them where
they live, by convention, and builds the catalog on every run. You maintain the
code, and the catalog follows it.

That difference shapes the rest. EventCatalog gives you an authoring surface.
Autocatalog gives you a catalog that matches the code at every commit, and a
pull request check that uses it.

## One catalog across many repositories

Both tools bring separate teams' work into one catalog, in different ways.

EventCatalog federates catalogs. Each team keeps its own EventCatalog project,
and a central catalog lists those sources in its config and merges them at
build time.

Autocatalog aggregates repositories. A team enrols by adding a GitHub topic to
its repository, and `ac site --topic` clones every enrolled repository and
builds the catalog from its code, contracts and docs. Nobody keeps a list of
sources, and no team maintains a catalog project of its own.

The two combine. A repository can commit its `ac to-eventcatalog` export and
join EventCatalog Federation as a source
([how](/docs/site#as-an-eventcatalog-federation-source)).

## What the autocatalog site covers

`ac site` builds one static site from every enrolled repository:

- pages for events, with schema, examples, version history and a changelog
  generated from the schema diff
- pages for services and domains, each with a map of what it produces and
  consumes, and who sits on the other side
- a catalog map of every service, event, command and datastore
- API reference pages for each committed OpenAPI spec, and a page for any
  other specification (WSDL, XML Schema, GraphQL, AsyncAPI)
- business process flows that cross repositories, grouped by domain or team
- a schema index, a field index and owner pages
- your teams' Markdown docs, with Mermaid diagrams, owner and last-changed date
- `llms.txt`, `llms-full.txt`, and a Markdown copy of every document, event and
  service page, for agents

The maps use EventCatalog's MIT visualiser, so they look familiar if you know
EventCatalog.

## Where autocatalog goes further

**A gate on the pull request.** `ac drift` scans your default branch and the
branch under review with the same adapters, compares the two, and names the
consumers each breaking change reaches. Teams in other repositories declare what
they read, and the check finds them through the company site.

**Provenance on every fact.** Each field records whether someone declared it,
the scanner extracted it, or autocatalog inferred it, with a link to the source.
Anything it cannot establish is marked for review.

**Runtime evidence.** With [autotel](https://github.com/jagreehal/autotel), the
event page shows what the service sent during its tests, and `ac drift
--snapshot` fails CI on events or fields nobody declared.

**Data ownership.** Autocatalog sees which services read and write which tables
and collections, and flags a pull request that has one team reading another
team's data.

## Where EventCatalog goes further

**Breadth of resource types.** Flows, entities, users, ubiquitous language and
data products are first-class in EventCatalog. Autocatalog keeps to
events, commands, services, domains, datastores and docs.

**Authoring.** Rich MDX components, custom pages and API routes, and a resource
model you shape yourself suit a catalog that people write.

**A product around it.** EventCatalog offers authentication, an assistant, and
commercial support.

If those matter more to you than deriving the catalog from code, EventCatalog is
the better fit.

## Run them together

Autocatalog covers the same everyday jobs its own way, and works with
EventCatalog wherever the licences allow. It ships only MIT code, including
EventCatalog's MIT SDK and visualiser. What you run on top, such as EventCatalog
5, follows that tool's own licence.

Autocatalog can feed EventCatalog, so a team can keep EventCatalog as its portal
and still derive the content from code:

```bash
ac to-eventcatalog ./my-eventcatalog
```

The export writes events, commands, queries, services with their owners,
repositories, systems and datastores through EventCatalog's MIT SDK. Importing
the project again gives back what went out
([running both](/docs/events/importing#running-both)). `ac site --eventcatalog`
builds EventCatalog 4 into the autocatalog site and embeds its diagrams on event
and service pages.

With autotel in the mix, each tool has one job. Autocatalog derives the catalog
and writes EventCatalog. Autotel's `ArchitectureSnapshotSubscriber` records what
each service sent during its tests, and `autotel-eventcatalog` adds that
evidence to the EventCatalog pages. Autocatalog reads the same snapshot, so both
tools agree on what ran. [Experiment 05](https://github.com/jagreehal/autocatalog/tree/main/experiments)
builds both catalogs from the same repositories side by side.

To try autocatalog on an existing EventCatalog project:

```bash
ac from-eventcatalog ./my-eventcatalog --out ./events
```

Events, commands, queries, services and datastores come across
([what maps to what](/docs/events/importing#from-eventcatalog)). The command
names anything without a counterpart, and `--strict` fails if it skipped
something.

## Licences

Autocatalog is MIT, including the site, the MCP server and every agent surface.

EventCatalog's core moved to the Business Source License 1.1 in version 5. Read
[its licence](https://github.com/event-catalog/eventcatalog/blob/main/packages/core/LICENSE)
for the production-use terms. Its SDK, CLI, visualiser, linter, diff and
connectors packages are MIT, and autocatalog builds on the SDK and the
visualiser. `ac site --eventcatalog` installs EventCatalog 4, whose core is MIT.

## Choosing

Start with autocatalog when your contracts already live in code and you want the
catalog, the docs and the pull request check to follow them.

Start with EventCatalog when people author the catalog, or when you need its
resource types, custom pages or commercial support.

Use both when you want EventCatalog's portal with content derived from code.
