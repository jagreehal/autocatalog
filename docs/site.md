---
title: The company site
owner: Maintainers
summary: One command builds one site from every enrolled repository.
tags:
  - reference
related:
  - docs/quick-start
  - docs/cli
  - docs/docs-convention
---

`ac site` builds one Starlight site from the repositories you enrol. Documents,
events, services and fields share one index, with Starlight's search, navigation
and dark mode.

## Build it

```bash
npx autocatalog site --topic catalog --owner acme \
  --site https://acme.github.io --base /catalog/
```

The command lists every repository `acme` owns with the `catalog` topic, clones
each one with its history, and writes the site to `dist/`. A team enrols its
repository by adding the topic on GitHub. Nobody edits a list in the site's
repository, and the site's owners approve nothing.

| Flag                 | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `--topic`, `--owner` | Clone every repository the owner has with the topic             |
| `--repo <url...>`    | Clone these repositories as well                                |
| `[root]`             | Build from checkouts already on disk, or from one repository    |
| `--site`, `--base`   | Where the site is served, for links, the sitemap and `llms.txt` |
| `--title`            | The site's title                                                |
| `--out`              | Output directory, `dist` by default                             |
| `--dev`              | Serve with live reload                                          |
| `--eventcatalog`     | Draw diagrams with EventCatalog, inside this site               |
| `--docs-schema`      | The docs frontmatter contract to enforce                        |

Set the flags once in `package.json` and reuse them for the dev server:

```json
{
  "scripts": {
    "build": "autocatalog site --topic catalog --owner acme --site https://acme.github.io --base /catalog/",
    "dev": "npm run build -- --dev"
  }
}
```

The command prints how many repositories it cloned and whether it had a token.
Private repositories need `GITHUB_TOKEN` or `GH_TOKEN`. The command sends the
token as a request header, so it never lands in a clone's `.git/config`.

The command clones each repository once, even when you enrol it by topic and
by `--repo`. When a clone fails, it names the repository with git's message and
builds the site from the rest. It writes `--out` once the build completes, so a
failed build leaves your last site in place.

Run `npx autocatalog site .` inside one repository to preview what it publishes
before you enrol it.

Every document must satisfy the company's frontmatter contract, or the build
fails and names the document. The contract is `--docs-schema` when given, else
`contracts/docs-frontmatter.json` at the root, else the one an enrolled
repository publishes there, such as a handbook. Copies other repositories keep
with `ac docs sync-schema` are the same contract; two repositories publishing
different ones fail the build, naming both, until `--docs-schema` picks one.

## What each page shows

- `/` lists every document by repository, with its owner and last change.
- `/<repo>/<path>/` is one document: its owner, the date git last saw it change,
  a link to the file on its repository, and the documents on either side of its
  `related` edges.
- `/events/<repository>/<domain>/<id>/` is one event: where its contract was
  found, its schema as a tree, its examples, any narrative the team wrote beside
  it, and the services that produce and consume it. The repository and domain
  are in the address, so two repositories can publish the same event id.
  Earlier versions sit under it at `v/<version>/`, with what changed between
  each: a committed catalog's `versioned/` folders, or, for a repository that
  publishes only `contracts/`, each earlier version its contracts declared in
  the last 50 commits to `contracts/`, read from git without checking anything
  out. A contract that declares no version has no history.
  Without a committed `events/`, a repository's events are what `contracts/`
  holds (JSON Schema, OpenAPI, Avro, protobuf) plus any
  [autotel-message-contract](/docs/events/message-contracts) approved file,
  `__contracts__/*.approved.txt`, anywhere in it. Nothing else outside
  `contracts/` is read, and that walk skips `node_modules`, `dist` and
  dot-folders and reads only regular files.
- Runtime evidence: when a repository has `.autotel/snapshot.json`, where
  autotel's `ArchitectureSnapshotSubscriber` writes it, the site joins it onto
  that repository's current events, committed catalog or discovered contracts
  alike, so the event page shows what ran without committing `events/`, and
  contract history from git still works. Only a regular file inside the
  repository is read, never a symlink. A snapshot that does not read is a
  warning in the build, and the repository's events publish without evidence.
- `/services/<name>/` lists what one service produces and consumes. The pages
  come from each event's `producers` and `consumers`, so declaring
  `producers: ['InventoryManager']` on an event creates the InventoryManager page.
- `/domains/<domain>/` gathers the events in one domain, the services around
  them and their owners, with a map of the domain. `/domains` lists them all.
- Maps on service and domain pages use EventCatalog's MIT visualiser. A service
  map shows the services on the other side of each event, and the catalog map
  adds commands, queries and the tables and collections each service reads and
  writes.
- When a repository has a snapshot, the maps draw it on each producer and
  consumer edge. An edge that ran is solid in the extracted colour, and thicker
  the more often it ran. One the catalog declares that the snapshot never saw is
  dashed and grey. One that ran though nobody declared it, a consumer or
  producer only the snapshot names, is in the inferred colour. Event names
  ignore case and `.`, `_`, `-`, so `order.placed` is `OrderPlaced`. A
  repository without a snapshot draws its edges as before.
- Those maps also have a Replay mode, which sends markers across the edges that
  ran, more often where the snapshot saw more, and a Live mode when the site is
  given a server-sent events feed. Live moves an edge each time a frame names its
  event: a JSON frame like `{ "name": "order.placed", "producer": "OrderService" }`
  moves that producer's edge, or every producer's when it names none, and every
  consumer's edge with a hollow marker, since a producer's frame does not prove
  delivery. Pass `ac site --live-url <url>` (and `--live-event <name>`, the SSE
  event name, `message` by default), or set `live: { url, event }` on the
  `autocatalogDocs` plugin. The site only listens; it does not
  serve the feed. With reduced motion an edge brightens in place instead of
  carrying a marker.
- `/apis/<repository>/<name>/` renders each OpenAPI 3 spec a repository commits
  under `contracts/` with [Scalar](https://scalar.com), and publishes the spec
  beside it as `openapi.json`. Without JavaScript the page lists the operations.
  A service links to the API whose title names it or whose webhooks it
  produces.
- `/specs/<repository>/<name>/` shows any other specification a repository
  commits under `contracts/`, as written and highlighted, with the file beside
  it under its own name. A WSDL, XML Schema, XML, GraphQL or RAML file counts by
  its extension, and a JSON or YAML file when it declares `asyncapi:`. Any other
  JSON or YAML file counts when a sidecar beside it declares it:
  `carrier-sla.autocatalog.json` holding
  `{ "specification": { "name": "Carrier SLAs", "summary": "…", "service": "ShippingService" } }`.
  The service it names, or one its title names, lists it under APIs and
  specifications. A sidecar naming a service no event mentions is a build
  warning. Only regular files up to 1 MB of text are published. `/specs` lists
  them all.
- `/flows/<repository>/<id>/` draws a business process a repository declares in
  `flows/<id>.md`: each step, the branches between them and the Markdown below
  the frontmatter. The map walks through it one step at a time, and groups it by
  domain or by owning team, as boxes or lanes. Each step names an event as
  `domain/id`, a service or an agent, or someone outside the catalog:

  ```yaml
  ---
  title: Order to dispatch
  steps:
    - id: customer
      actor: { name: Customer }
      next_step: { id: pay, label: Pays }
    - id: pay
      service: PaymentService
      next_steps:
        - { id: captured, label: Card accepted }
        - { id: declined, label: Card declined }
    - id: captured
      event: payments/payment.captured
    - id: declined
      title: Ask for another card
  ---
  ```

  An `externalSystem` step takes a `name`, `summary` and `url`, and a `custom`
  step a `title`, `summary` and `url`. A flow can name
  another repository's resources. One whose step names nothing in the catalog
  is left out with a warning. `ac docs check` fails a flow that does not hold
  together (a step leading nowhere, a step naming two things, a link that is not
  a web address) and leaves a step naming something outside the checkout to the
  site, since one repository's CI cannot see the others. The walkthrough starts
  at the first step nothing leads to, so a flow where every step has one leading
  to it is a build warning. A hop the
  catalog does not back, such as a service the flow says produces an event no
  producer declaration names, is a build warning, and the flow still publishes:
  the flow is what the team says happens, and the catalog is what the code
  declares. Event and service pages list the flows they are a step in, and
  `/flows` lists them all.

  A flow's map opens grouped the way its frontmatter says: `lanes: team` groups
  it by owning team as boxes, and `lanes: { by: system, style: lanes }` stacks
  each system in a lane. `by` is `domain`, `system`, `team` or `domain-system`.
  A step the catalog places in the wrong lane, or does not place at all, says
  where it sits with `lane: { team: Storefront }` (any of `domain`, `system`,
  `team`); the step's own lane wins over the catalog's.

- `/designs/<repository>/<id>/` draws architecture a repository proposes in
  `designs/<id>.md`, before anyone builds it. The frontmatter holds resources
  and relations in the vocabulary of EventCatalog Studio's model, so the same
  design opens there:

  ```yaml
  ---
  title: Refunds
  status: proposed
  resources:
    - { id: payments, type: domain, name: Payments }
    - { id: refunds, type: system, name: Refunds, parent: payments }
    - { ref: service/PaymentService, parent: payments }
    - { ref: event/payments/payment.captured }
    - { id: RefundService, type: service, parent: refunds }
    - { id: refund.issued, type: event, name: Refund issued }
  relations:
    - { from: RefundService, to: payment.captured, kind: receives }
    - { from: RefundService, to: refund.issued, kind: sends }
  notes:
    - { text: Who approves a refund over £500?, resource: RefundService }
  ---
  ```

  A resource names a catalog resource with `ref:` (written as `about:` writes
  one), or gives an `id` and `type`; one written by name is the catalog's when
  the catalog has a resource of that kind and name. Relation kinds are `sends`,
  `receives` (both from the service to the message), `routes-through`, `reads`,
  `writes` and `connects`. The page says what the design adds ("1 new service,
  1 new event and 2 new relations"), draws what is new in outline, and offers
  three levels: L3 everything, L2 the services and stores with each message
  between them as one edge, L1 the domains and systems. Once the code ships, the
  page shows those parts as in the catalog. `ac docs check` fails a design that does
  not hold together (a `ref` that resolves to nothing, a relation or `parent`
  naming no resource), and `/designs` lists them all.

- `/data/<repository>/<model>/` is one table or collection: where its
  definition was read, who owns it, its fields (type, required, primary key,
  unique, default, database name, enum values, the model a key column points
  at), its relations, its indexes, an entity-relationship diagram of the model
  and every model one relation away, and the services that read and write it.
  `/data` lists every model with its datastore, repository, owner, field count,
  readers and writers. Maps and the Catalog link each table and collection to
  its page. Models come from each repository's `.autocatalog/resources.json`,
  or, without one, from the site scanning the repository's Prisma, Drizzle and
  Mongoose code; see [brownfield resources](/docs/brownfield-resources).
- `/schemas` lists every event schema with its format, version, domain and
  owner.
- `/fields` lists every field across every event, the services a change to it
  would reach, and the fields whose type or requiredness disagrees between
  events.
- `/retirements` lists each deprecated event, and each field a schema marks
  `deprecated: true`, with where every consumer stands
  ([retiring a field](/docs/retire)). It appears once there is one.
- `/catalog` shows the whole knowledge graph, and `/catalog.json` holds the same
  graph as JSON.
- `/decisions/`, `/runbooks/` and `/incidents/` list every ADR, runbook and
  incident across every repository, newest first, in a table of the columns the
  conventions file names. The status shows as a badge, and the table filters by
  status and by repository. The decisions page also draws each supersede chain,
  oldest first. A kind the organisation adds gets the same page at its own
  `path`, and a kind with no documents gets no page. The Catalog sidebar group
  and the home page's Explore cards link each one, and the home page counts
  them.
- A decision, runbook or incident page is still the document, with its state as
  a badge under the title and its kind, date, other fields, what it applies to
  (its `about:` targets, linked to their service and event pages) and what it
  supersedes or was superseded by.
- Service and event pages list the decisions, runbooks and incidents that name
  them in `about:`, one card per kind, beside their other documents.
- `/contracts/docs-manifest.json` lists every document and who links to it.
  Point `ac docs check --manifest` at it and each repository's CI catches a link
  to a missing document, or a rename that would orphan a link from elsewhere.

## For agents

Every document, event, service and data model page has a Markdown twin at `<url>.md`. Its
frontmatter adds `updated`, `source` and `url`, so an agent can cite who owns an
answer and when it last changed. Each page's `<head>` links to its twin. Every
event publishes its contract at `schema.json` beside its page. `/llms.txt` lists
documents and events together, and `/llms-full.txt` holds the full text of
every document, event and data model. A decision, runbook or incident's twin
also carries `kind`, even when its folder alone set it, and its `llms.txt` line
ends with its kind, status and date.

A ` ```mermaid ` fence in a document or an event's `index.mdx` renders as a
diagram in both themes, and the twin keeps the source.

## Deploy with GitHub Pages

```yaml
name: site
on:
  push: { branches: [main] }
  schedule: [{ cron: '17 * * * *' }]
  workflow_dispatch:

permissions: { contents: read, pages: write, id-token: write }

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx autocatalog site --topic catalog --owner acme --site https://acme.github.io --base /catalog/
        env: { GITHUB_TOKEN: '${{ github.token }}' }
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v4
```

The hourly schedule picks up a newly enrolled repository without anyone
touching the site's repository.

## Narrative alongside generated state

An event folder may contain an `index.mdx`. Its body renders on the event page
without changing any generated field, so a runbook step or a caveat lives next
to the contract. Regenerating the catalog leaves it alone.

## Diagrams

`--eventcatalog` has [EventCatalog](https://www.eventcatalog.dev) draw the
diagrams, inside this site rather than beside it:

```bash
npx autocatalog site --topic catalog --owner acme --base /catalog/ --eventcatalog
```

The command writes the composed catalog into an EventCatalog project, builds it
under `<base>eventcatalog/`, and puts the result in the same output, so it
deploys with the site. The Catalog group gains an Architecture page that hosts
EventCatalog whole, its own header and navigation included, inside the site's
layout. `/architecture/?at=<page>` opens it at any EventCatalog page, and the
address follows the reader around EventCatalog, so a reload or a shared link
reopens the same diagram. EventCatalog takes the site's light or dark theme and
switches with it. Each event and service page links to its diagram there.
Without JavaScript the Architecture page links to EventCatalog directly.
Without the flag, nothing about EventCatalog appears.

EventCatalog is installed with npm, once, into `eventcatalog/` beside the
`--cache` directory, and installed again only when the pinned range changes.
The range is `@eventcatalog/core@^4.10.7`: EventCatalog 5 moves to the Business
Source License, so the site stays on 4. EventCatalog 4 is MIT apart from its
enterprise code, which is under EventCatalog's commercial licence; its
`LICENSE` is published beside its output, at `eventcatalog/LICENSE`. The site
never works around EventCatalog's licence key: without one, EventCatalog shows
its own navigation.

EventCatalog 4's build reports anonymous usage to EventCatalog (organisation
name, resource counts, a content hash) and has no setting to turn that off.
Nothing else in autocatalog sends anything, so the build says so when it runs
EventCatalog.

With EventCatalog's licence key (`EVENTCATALOG_LICENSE_KEY_BACKSTAGE`, read
from the environment by EventCatalog itself), its embed mode is allowed, and
event and service pages show their diagram inline as well, without
EventCatalog's navigation. The build fails if a page the site links to was not
built. The broken-link check covers the site's own pages and leaves
`eventcatalog/` to EventCatalog. Only a build draws diagrams, so
`--eventcatalog` does not combine with `--dev`.

## EventCatalog on its own

To keep a separate EventCatalog project, write the catalog into it:

```bash
ac to-eventcatalog ./eventcatalog --root ./events
```

The same export runs as an EventCatalog generator, so an existing EventCatalog
project adds one line to `eventcatalog.config.js`:

```js
generators: [['autocatalog-cli/eventcatalog', { repositories: ['../payments-service'] }]];
```

`eventcatalog generate` then scans each repository the way `ac scan` does and
writes what it finds. The adapters a repository installs come with it: set
`allowCodeExecution: true` for one that defines its events in Zod, and the
generator runs `autocatalog-adapter-zod` and any
[adapter of your own](/docs/adapters) in its isolated process. `roots` reads
`events/` folders a repository already scanned and committed. When a scan
fails, `eventcatalog generate` exits 1, and your CI stops before it publishes.

Each event page in EventCatalog leads with where its contract was found. A
domain retired in source disappears on the next export. The export lists every
file it wrote in `.autocatalog-export.json` and removes only those next time, so
a page, diagram or asset added by hand stays, even inside a generated domain.
Each file is recorded before it is written, so a failed export can be run
again. If the manifest can't be read, the export stops and deletes nothing.
Upgrading a project exported before the manifest existed removes only files
with proof that autocatalog wrote them. Anything it can't be sure of, such as
an example or a service linked to a generated domain, stays and is reported.
A resource someone else already wrote under the same id is left alone and
reported.

### As an EventCatalog Federation source

EventCatalog Federation (an EventCatalog Enterprise feature) combines many
teams' EventCatalog projects into one. A repository joins as a source by
committing its export:

```bash
ac to-eventcatalog ./eventcatalog --root ./events
```

and the central catalog names that folder:

```js
federation: {
  sources: [{ id: 'payments', source: 'github:acme/payments-service', path: 'eventcatalog' }],
}
```

Federation indexes the folder with the EventCatalog SDK's `buildIndex`, and
autocatalog's tests build that index from every export. For autocatalog's own
site, `ac site` reads the same repositories' contracts.

### With autotel

autotel's `autotel-eventcatalog` can also write EventCatalog resources
(`generate`), but from a runtime snapshot: ids, versions and schemas inferred
from what the tests sent, with no owners, contracts or unexercised events. Keep
one writer. Generate with autocatalog, and let autotel stamp and check:

```bash
npm test                     # ArchitectureSnapshotSubscriber writes .autotel/snapshot.json; commit it
ac drift --base-ref origin/main --root . --snapshot .autotel/snapshot.json --fail-on suspicious
ac site <root> --eventcatalog  # evidence on the site's event pages, exported into EventCatalog
npx autotel-eventcatalog stamp --snapshot .autotel/snapshot.json --catalog <project>
```

`stamp` writes its evidence into each event page between
`<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->`. The export
rewrites the page but keeps that block where it was, so a later export,
including the generator inside an EventCatalog build, does not erase it, and
stamping again changes nothing. `ac drift --snapshot` is the runtime gate, in
the same report as the contract changes: events and fields the code sends that
the catalog does not declare, matched as `autotel-eventcatalog drift` matches
them (see [Drift gating in CI](/docs/drift-ci#runtime-drift)).

Each event's `transport` becomes an EventCatalog channel: one channel per
address, however many events share it, with the address and protocols. The
services that send and receive the event point at it (`sends[].to`,
`receives[].from`, where EventCatalog 4 keeps them, carrying the delivery
mode); an event no service sends or receives points at it itself. Channels are
owned through `.autocatalog-export.json` like every other page, and
`ac from-eventcatalog` reads them back as `transport`.
[Experiment 05](https://github.com/jagreehal/autocatalog/tree/main/experiments) runs this end to end.

EventCatalog gives each event id one page. If two repositories, or two domains,
publish the same id, the export stops before writing anything and names both.
Rename one, or export them to separate EventCatalog projects.
