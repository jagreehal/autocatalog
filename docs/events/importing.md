---
title: Importing an existing catalog
owner: Maintainers
summary: Bring in events from GitHub, AsyncAPI, or an EventCatalog project.
tags:
  - events
  - migration
related:
  - docs/comparison
  - docs/cli
---

Three importers, for the three places event contracts usually already live.
All of them write the same generated event folders, so an import is a starting
point rather than a parallel format you now have to maintain.

## From a GitHub repository

Pull schemas and examples from another repository without copying files by hand.

Single event:

```bash
ac import \
  --github-repo acme/contracts \
  --ref main \
  --id payment.completed \
  --domain payments \
  --version 1.0.0 \
  --schema-path schemas/payment.completed.json \
  --example-path examples/payment.completed.json
```

Bulk, from a manifest committed in that repository:

```bash
ac import \
  --github-repo acme/contracts \
  --ref main \
  --manifest-path autocatalog.sources.json
```

```json
{
  "events": [
    {
      "id": "payment.completed",
      "domain": "payments",
      "version": "1.0.0",
      "name": "Payment Completed",
      "summary": "Payment has completed",
      "schemaPath": "schemas/payment.completed.json",
      "examplePaths": ["examples/payment.completed.json"]
    }
  ]
}
```

Add `--dry-run` to plan the import without writing anything.

`ac import` uses `gh` by default, so a private repository works if `gh` is
authenticated. `--github-token-env GITHUB_TOKEN` passes a token instead, and
`--clone-with git` falls back to plain git. Remote URL imports are restricted to
`raw.githubusercontent.com` and `github.com` unless you pass `--allow-host`.

## From AsyncAPI

```bash
ac from-asyncapi ./asyncapi.yaml --out ./events
```

Both 2.x and 3.x documents are supported. Everything the importer cannot resolve
is reported rather than dropped: an unresolvable `$ref` on one message costs that
message, not the channel it lives on, and the run ends with a count of what was
skipped and why.

Fail the command when anything was skipped — the right setting for a migration
running in CI:

```bash
ac from-asyncapi ./asyncapi.yaml --out ./events --strict
```

A message's own version comes from EventCatalog's
`x-eventcatalog-message-version` where it has one. An event is its domain, id
and version together, so `billing`'s `created` and `sales`' `created` stay two
events, and two versions of one event import as the newest with the older as
its history. A payload that refers to
`components.schemas` keeps those definitions in its own `$defs`, so the schema
stands alone. An example named `duplicate/redelivered` is the `redelivered`
example in the duplicate case, which is also where EventCatalog's generator
writes it. A document `ac to-asyncapi` wrote comes back exactly: ids, versions,
owners and delivery promises ride along under `x-autocatalog`.

## From EventCatalog

```bash
ac from-eventcatalog ./my-eventcatalog --out ./events
ac resources scan .
```

| EventCatalog                                       | Becomes                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| events, with their history                         | events under `--out`                                                                                                                                                      |
| commands                                           | commands under `commands/eventcatalog/`: senders from the services that send them, the handler from the one service that receives them                                    |
| queries                                            | commands whose outcome is a result, tagged `query`                                                                                                                        |
| services                                           | services, under the domain that files or lists them                                                                                                                       |
| containers, and services' `writesTo` / `readsFrom` | tables (collections for a document store) and the reads and writes on them, so [drift](/docs/drift-ci#another-teams-datastore) sees one team reaching into another's data |
| owners, and `teams/` and `users/` pages            | the first owner, team or user, of each of these, named as its page names it, with its Slack or Teams link or email to reach it                                            |
| systems                                            | the system each service is part of, whether the system lists it or holds it in its folder                                                                                 |
| channels                                           | each message's transport, and its delivery guarantee                                                                                                                      |

Commands go to `commands/eventcatalog/` and services and datastores to
`.autocatalog/imports/eventcatalog.json`, both under `--cwd`, which defaults to
the folder holding `--out`. Both belong to the import: running it again
replaces them, so a command or service the catalog dropped goes too, and
commands of your own beside them are left alone. A command that fails to
import keeps the version imported before, and the import names it. A command,
service or datastore page whose frontmatter cannot be read could be any of its
kind, so then none of that kind imported before is dropped, and each one kept
is named. `ac resources scan` adds them
to the graph. Schemas are read in the JSON Schema dialect they
declare, so draft-07, which EventCatalog's own examples use, validates as
draft-07.

Entities, flows and ADRs have no autocatalog counterpart, and neither do a
team or person that owns nothing or a system that groups no service. The
import names each kind it left behind and how many, rather than leaving them
out quietly. A team's members and a system's own summary and owners stay
behind too. A command that several services receive gets
no handler, and the import says so: a command has exactly one. Two services
that share a name become one service, as their events already treat them.

Markdown documents become generated manifests. A document with unparseable
frontmatter, an invalid `schema.json`, or no id is skipped and named, and the
rest of the catalog still imports. `--strict` turns any skip into a non-zero
exit.

An event's `classification` has no EventCatalog field, so `ac to-eventcatalog`
writes it as a `classification: <value>` badge and `ac from-eventcatalog` turns
that badge back into the field.

Examples come across with their case folders, and a channel's
`deliveryGuarantee` becomes the guarantee of the events on it when every
channel an event travels on agrees. `ac to-eventcatalog` writes the other way:
the guarantee on each channel whose events agree, the rest of `delivery` under
`x-autocatalog`, and an `examples.config.yaml` naming each case for
EventCatalog's readers.

### Running both

`ac to-eventcatalog` writes all of it back: commands and queries, services with
their owners, repositories and the datastores they read and write, the
datastores, the systems grouping the services, and a page for each owner with
its name and contact, from the `.autocatalog/resources.json` beside each
`events/` root. A team, person or system page EventCatalog already has is left
as it is.
Importing what it wrote gives back what was imported, so a team
can keep EventCatalog as its portal while autocatalog gates the pull requests:

```bash
ac from-eventcatalog ./my-eventcatalog --out ./events
ac resources scan .
ac to-eventcatalog ./my-eventcatalog --root ./events --narrative
```

A page the export wrote opens with where the contract came from and ends with
EventCatalog's schema viewer; importing it again leaves both out of the
narrative, since the next export adds them. A datastore a service names but
that nothing describes stays a pointer, as it was, rather than gaining a page.
Entities, flows and ADRs are not touched.

Placeholder schemas are reported as a caveat rather than a skip: the event
imports, and the catalog tells you its schema needs attention.

## After importing

Imported events are ordinary generated state. Run [validation](/docs/events/validation),
then decide whether to keep importing or to move the contracts into code with
[Zod](/docs/events/zod) or [Pydantic](/docs/events/pydantic) — which is where the
drift gate starts paying for itself.
