---
title: Choosing between autocatalog and EventCatalog
owner: Maintainers
summary: An accurate account of what each tool bets on, and when the other one is the better choice.
tags:
  - overview
related:
  - docs/introduction
  - docs/events/importing
---

EventCatalog is the mature tool in this space and it is genuinely good. If you
are choosing, the honest framing is not "which is better" but "which bet suits
you", because the two tools disagree about one thing and agree about most of the
rest.

Everything on this page was checked against a local checkout of EventCatalog
core 4.12.3 and its 5.0.0-beta.11 branch on 9 October 2026. If something here is
out of date, that is a bug — please open an issue.

## What EventCatalog actually does

Claims that EventCatalog cannot automate or accept your own content are wrong,
and this page used to make some of them. For the record, 4.3.4 ships:

- **Generators.** Build-time plugins configured in `eventcatalog.config.js` and
  called on every build. They are the foundation of its plugin model, and there
  is a large ecosystem of them.
- **A programmatic SDK** for reading and writing catalog resources.
- **Connectors**, including a contract for writing your own.
- **Bring your own documentation** — markdown and MDX, both catalog-wide and
  attached to a specific resource, with diagrams.
- **Custom Astro pages and API routes**, so the catalog can host internal tools,
  dashboards and live data.
- **A linter, a CLI, and a visualiser.**

Some of that is commercially gated: bring-your-own-documentation, custom pages
and API routes, the MCP server, the assistant, authentication and several
governance features carry a plan banner in their own documentation. That is a
legitimate distinction to draw, and it is a different claim from "the capability
does not exist".

## Licensing

EventCatalog 4 is MIT, apart from its federation and enterprise directories,
which carry a commercial licence.

EventCatalog 5, in beta at the time of writing, moves core to the Business
Source License 1.1. Production use is granted to individuals, to organisations
with under USD 10 million in both annual revenue and total funding, to people
documenting a public open-source project, to education, and to organisations in
an evaluation period. Everyone else needs a commercial licence. Each version
becomes MIT four years after its release. The SDK stays MIT.

Autocatalog is MIT throughout, with no licence key, no plan and no telemetry.
`ac site --eventcatalog` is the one exception you opt into: it installs and
builds EventCatalog 4, whose build reports anonymous usage to EventCatalog and
has no switch to turn that off.

## The one thing the two tools disagree about

**EventCatalog's model is a catalog you assemble.** You configure generators,
write or import resources, and the catalog is the artifact you maintain. That
gives you enormous control, twenty-odd resource types, and a place to put
anything.

**Autocatalog's model is a catalog you cannot maintain, because there isn't one
to maintain.** Discovery is by convention: schemas in the repository, prose in
`docs/`. What you get is derived, and the only thing you own is the source it
was derived from.

Everything below follows from that one difference.

## What autocatalog bets on

**Convention over assembly.** Point it at a repository. There is no config file
listing which generators to run, because there is no generator list — passive
discovery finds JSON Schema, adapters that are installed contribute, and prose
is whatever is committed under `docs/`.

**No second model.** The catalog is generated state, not a copy of your contract
that someone has to keep in step. There is no "update the docs" step in a pull
request, so there is no way to skip it.

**Provenance on every field.** Each field records whether it was `declared`,
`extracted` or `inferred`, and links to the source that produced it. What cannot
be established is marked `needsReview` rather than filled in with something
plausible. Automation without provenance asks for trust it has not earned.

**Overrides layered on top, never underneath.** An `index.mdx` body renders next
to the generated fields without changing them, and regeneration leaves it alone.
Manual content is an override layer, not the foundation.

**Consumer-aware drift from two git states.** `ac drift` scans your default
branch and the pull request through the same adapters and compares the results.
Because both sides are generated, the gate cannot be bypassed by forgetting to
update a spec — and because events declare consumers, the failure says which
services break, not just which fields changed.

**Transactional publication.** A scan either publishes one complete, validated
catalog or leaves the previous one untouched. A partial catalog that looks
complete is worse than a failed build.

**Static, and free.** Plain static output you can host anywhere, and the MCP
server, `llms.txt` and the markdown twins are MIT with no plan attached. There is
no licence key and no telemetry anywhere in this project. The one exception is
`ac site --eventcatalog`, which runs EventCatalog's own build, and that reports
usage to EventCatalog.

## Choose EventCatalog if

- You need breadth of resource types — domains, flows, teams, ubiquitous
  language, channels — as first-class things
- Your documentation is genuinely authored rather than derived, and markdown-first
  authoring is the point
- Your source format already has a generator there and does not have an adapter
  here
- You want the catalog to host custom pages, dashboards and API routes
- You want commercial support, and five years of surface area behind you

## Choose autocatalog if

- Your contracts already live in code, and a second copy of them in markdown is
  the problem you are trying to remove
- You want to know where every field came from, and to be told when the tool is
  guessing
- You want a CI gate that fails the pull request that breaks a consumer
- You want every AI surface — MCP, `llms.txt`, markdown twins — to be free
- You would rather adopt a convention than assemble a pipeline

## What autocatalog deliberately does not build

Commands, queries, flows, channels and teams as resource types (until someone asks for
them), a DSL or language server, themes, auth — it is a static site, host it behind
whatever you already have — hosted chat with a plan tier, Slack bots, federation, and
analytics integrations.

The Agents site does ship a BYOK browser assistant that calls the same catalog tools as
`ac agents mcp`. That is a thin local surface, not a product chat stack: your key stays
in the browser, and coding agents are still expected to use MCP / `llms.txt`.

Every one of these is EventCatalog playing to its strengths. Matching that breadth would
cost the thing this tool is for. Diagrams and the visualiser in particular are
EventCatalog's job: export to it instead of rebuilding them here.

## Running both

They are not exclusive. Autocatalog owns discovery, validation, drift and the AI
surfaces; EventCatalog can render the result. `ac to-eventcatalog` writes the
catalog into an EventCatalog project through its MIT SDK, so the pictures stay
true to the code: events, commands, queries, services with their owners,
repositories and systems, and the datastores they read and write. Importing that project
again gives back what went out, so a team can keep EventCatalog as its portal
([running both](/docs/events/importing#running-both)). Rendering with EventCatalog 5 puts that project under its
licence, above. `ac site --eventcatalog` builds EventCatalog 4 into the same
site and embeds its diagrams on event and service pages, so readers stay on
one site. Hiding EventCatalog's navigation inside the frame needs its licence key.

Add [autotel](https://github.com/jagreehal/autotel) and each tool has one job.
Autocatalog derives the catalog from contracts and writes EventCatalog;
autotel's `ArchitectureSnapshotSubscriber` records what the service sent during
its tests, and `autotel-eventcatalog` stamps that evidence onto the EventCatalog
pages. Autocatalog joins the same snapshot, committed at `.autotel/snapshot.json`,
onto its own event pages, and `ac drift --snapshot` fails CI on events or fields
nobody declared in the same report as the contract changes; the two tools'
drift checks agree on the same snapshot. Each event's transport is exported as
an EventCatalog channel. `autotel-eventcatalog generate` can write EventCatalog from the
snapshot alone, but then the catalog only knows what the tests ran: no owners,
no declared consumers, no required fields or enums, ids taken from the code,
and no events the tests skip. Run both writers and they fight over the same
pages, so generate with autocatalog and stamp with autotel. The export keeps the
stamped block across re-exports. [Experiment 05](https://github.com/jagreehal/autocatalog/tree/main/experiments)
builds both catalogs from the same repositories and compares them.

Trying autocatalog does not cost you a migration either:

```bash
ac from-eventcatalog ./my-eventcatalog --out ./events
```

Events, commands, queries, services and the datastores they read and write
come across ([what maps to what](/docs/events/importing#from-eventcatalog));
anything with no counterpart is named rather than dropped, and `--strict` fails the command if anything was skipped. Point it at a
copy, look at what comes out, and keep whichever tool answers your questions
better.
