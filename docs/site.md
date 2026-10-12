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

Private repositories need `GITHUB_TOKEN`. The command sends the token as a
request header, so it never lands in a clone's `.git/config`.

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
- `/fields` lists every field across every event, the services a change to it
  would reach, and the fields whose type or requiredness disagrees between
  events.
- `/catalog` shows the whole knowledge graph, and `/catalog.json` holds the same
  graph as JSON.

## For agents

Every document has a Markdown twin at `<url>.md`. Its frontmatter adds
`updated`, `source` and `url`, so an agent can cite who owns an answer and when
it last changed. Each page's `<head>` links to its twin. Every event publishes
its contract at `schema.json` beside its page, and `/llms.txt` lists documents and
events together.

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
generators: [['autocatalog-cli/eventcatalog', { roots: ['../payments-service/events'] }]];
```

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
