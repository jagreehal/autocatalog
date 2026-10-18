---
title: CLI reference
owner: Maintainers
summary: Every `ac` command, what it does, and the flags worth knowing.
tags:
  - reference
related:
  - docs/events/validation
  - docs/drift-ci
---

One binary. `ac` ships in `autocatalog-cli`, and the `autocatalog` package is the
same CLI under the name you can reach without installing anything:

```bash
npx autocatalog .        # scan this repository into events/
ac .                     # the same thing, once installed
```

A bare directory means `scan`, because a directory cannot mean anything else.
Every command that writes into your repository ends by saying what it wrote and
whether to commit it; `ac site --dev` writes nothing there. Run `ac <command> --help` for the full flag list; this
page covers what each command is for.

## Daily commands

`ac resources` discovers datastore access and commands, imports ownership and registry contracts, and reviews trace-inferred relationships: `scan`, `list` (the keys `promote` and `validate` take), `ownership`, `promote`, `drift`, `validate` and `import`. See [Brownfield resources](./brownfield-resources.md) for model adapters, OTLP discovery, document validation and CloudEvents examples.

```text
ac scan          Discover events across a repo and generate the catalog
ac site          Build one site from every enrolled repository
ac validate      Check every event
ac drift         Compare against a baseline and gate breaking changes
ac docs check    Validate repository-owned documentation
ac agents audit  Audit an agent catalog
ac import        Import schemas from a GitHub repo
ac to-eventcatalog  Write the catalog into an EventCatalog project
ac to-asyncapi   Write the catalog as AsyncAPI 3.0, for mock servers
```

## Building the catalog

**`ac scan [root]`** — discovers event definitions and generates the catalog.
Passive [JSON Schema](/docs/events/json-schema), [OpenAPI](/docs/events/openapi)
and [Avro / protobuf](/docs/events/avro-protobuf) discovery by default;
`--allow-code-execution` additionally runs installed runtime adapters such as
Zod, which evaluate repository code. `--out` sets the events directory
(default `./events`). It also discovers datastore models, commands and Backstage
ownership; when it finds any it writes `.autocatalog/resources.json` and
`<out>/resources.json`, says so, and counts them in the summary. A repository
without them gets no `.autocatalog/`. `--traces`, `--service`, `--datastore`,
`--database` and `--environment` work as for `ac resources scan`, and the
identities are saved to `.autocatalog/config.json`.

**`ac validate`** — validates every event. `--strict-warnings` turns warnings
into failures. It also checks `autocatalog.consumes.json`, and passes a
repository that only consumes other teams' events. `--catalog <url|file>`
checks each declared field against the schema the producer publishes on the
company site. See [validation](/docs/events/validation).

**`ac health`** — scores events on completeness, ownership, examples and
versioning. `--min <score>` exits non-zero below a threshold.

**`ac changelog`** — renders plain-language schema changelogs between versions.

**`ac drift`** — compares two catalogs and fails on breaking changes.
`--base-ref origin/main --root .` scans both git states; `--base` and
`--current` compare two directories, including the `resources.json` each carries
(a warning, and no resource comparison, when only one has it). `--format text | markdown | json | github`,
`--fail-on breaking | suspicious | never`. `--format github` annotates the pull
request diff; `--compatibility backward | forward | full | none` gates on a
Schema Registry strategy instead of severity. `--snapshot <file>` adds runtime
drift from an autotel snapshot to the same report: undocumented events and
undeclared fields (suspicious), documented events never seen (info), and the
consumers it recorded. `--consumers <url|file>` reads the company site's
`/catalog.json` and names the consumers other repositories declare, with
`--consumers-token-env` for a private site and `--repository` when two
repositories publish the same event. See [drift gating](/docs/drift-ci).

**`ac fields [query]`** — shows which events carry a field and which consumers
it reaches. With no query it lists every field by usage; with one it details a
single field. `--conflicts-only` shows just the fields whose type or
requiredness disagrees between events. See [fields](/docs/events/fields).

## Getting events in

**`ac import`** — imports schemas and examples from a GitHub repository, one
event at a time or from a manifest. See [importing](/docs/events/importing).

**`ac from-asyncapi <file>`** — imports an AsyncAPI 2.x or 3.x document.
`--strict` fails the command if any message was skipped.

**`ac from-eventcatalog <dir>`** — migrates an EventCatalog markdown project:
events to `--out`, commands and queries to `commands/eventcatalog/`, and
services and datastores to `.autocatalog/imports/eventcatalog.json`, both under
`--cwd`, which defaults to the folder holding `--out`. Importing again replaces
both, so nothing the catalog dropped is left behind.
`--strict` behaves the same way.

**`ac to-asyncapi`** — writes the catalog as an AsyncAPI 3.0 document, for a
mock server such as Microcks or for consumers who read AsyncAPI. `--service
<name>` gives one service's view: what it sends and what it receives. `--out`
picks the file, YAML unless it ends in `.json`. A structured CloudEvent is
described as what consumers receive, its envelope with the event as `data`,
and `ac from-asyncapi` unwraps it again. Invalid examples are left out;
see [cross-domain delivery](/docs/cross-domain-delivery#6-build-in-parallel).

**`ac scan --snapshot <file>`** joins a runtime architecture snapshot onto the
catalog. Events the snapshot saw gain an `observed` block — count, first and
last seen, and consumer participants — and a consumer recorded only in the
snapshot is added with provenance `observed`. Its `consumerEvidence` label
distinguishes reported metadata from observed delivery. Trace references,
producer/channel counts and field types are retained for investigation.

It reports two findings a static catalog cannot produce:

```text
13 observed, 2 declared but never seen, 1 undocumented
? parcel.shipped is documented but the runtime never saw it
! cart.abandoned ran but is not in the catalog
```

An event absent from a snapshot may belong to a flow that the run did not
exercise. Absence alone does not justify removing its contract. To gate on
them, and on undeclared fields, use `ac drift --snapshot`. `ac site` joins a
repository's `.autotel/snapshot.json` on its own, with no scan.

The snapshot is a contract, not an integration: nothing here imports the tool
that produced it, so any runtime in any language emitting the
`autotel-architecture/*` shape is a first-class source of evidence.
`fixtures/demo-repo/runtime-snapshot.json` is a worked example.

**`ac from-zod <file>`** — registered by `autocatalog-adapter-zod` when it is
installed. Adapters can add their own commands this way; `ac` discovers them
from `node_modules`. See [Writing an adapter](/docs/adapters).

## The site

**`ac site [root]`** builds one Starlight site from every enrolled repository.
`--topic` and `--owner` clone every repository with a GitHub topic, `--repo`
names repositories directly, and a root builds from checkouts on disk. `--dev`
serves instead of building. `--eventcatalog` builds EventCatalog into the site
and embeds its diagrams. `--docs-schema` names the docs frontmatter contract to
enforce; without it the site uses the root's, else an enrolled repository's.
`--docs-conventions` names the conventions file, found the same way.
See [the company site](/docs/site).

**`ac to-eventcatalog <dir>`** writes the catalog into an EventCatalog project
through EventCatalog's SDK, for its interactive diagrams. `--root` takes one or
more published `events/` directories. The `.autocatalog/resources.json` beside
each, which `ac resources scan` writes, adds its commands and queries, its
services' owners, repositories, systems and datastores, and the datastores themselves. Narrative stays out unless you pass
`--narrative`: EventCatalog compiles each page as MDX, which runs any code in it,
so only use it for repositories you trust to run code on your machine.

## Documentation

A second group of commands covers repository-owned prose rather than events. All
of them take an optional root and default to the current directory.

**`ac docs check`** — validates frontmatter against the contract, plus links
between repositories and documents that were deleted while something still links
to them. An ADR, runbook or incident is also checked against its kind's schema,
and its `supersedes` and `supersededBy` ids must resolve. `--conventions` names
the conventions file when the default lookup should not choose it.

**`ac docs manifest`** — publishes `contracts/docs-manifest.json`, the
aggregated index other repositories resolve links against. `ac site` serves
the same file at `/contracts/docs-manifest.json`.

**`ac docs init-schema`** — writes the default frontmatter contract into
`contracts/` so the organisation owns its copy from the start.

**`ac docs init-conventions`** — writes the built-in document kinds (ADRs,
runbooks, incidents) into `contracts/autocatalog.conventions.json` for the
organisation to edit: add a kind, change a folder, label or schema, or turn a
kind off. It refuses to overwrite a file that exists; `--conventions` writes
elsewhere.

**`ac docs sync-schema`** — checks that copy against the organisation's
canonical one, found from the `$id` the copy records. `--write` takes the
upstream version; `--from` overrides the source.

See [the docs convention](/docs/docs-convention) for what these enforce.

## Agents

**`ac agents <command>`** — the agent catalog commands: `validate`, `impact`,
`search`, `cost`, `audit`, `drift`, `discover`, `llmstxt`, `mcp`. They live in
`autocatalog-agents-cli`, which is an optional install — `ac agents` says so if
it is missing, because an events-only project should not carry the agent model.
Every flag behaves exactly as `ac agents --help` documents it.

See [agent catalogs](/docs/agents).
