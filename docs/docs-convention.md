---
title: The docs convention
owner: Maintainers
summary: Every repository owns its docs/; one site aggregates them. This site is the proof.
tags:
  - docs
related:
  - docs/cli
  - docs/mcp
---

The same argument as the event catalog, applied to prose: documentation belongs
in the repository it describes, and a central site should read it rather than
ask anyone to copy it.

A repository publishes by committing markdown to `docs/`. That is the whole
enrolment step. The site you are reading is built this way — these pages live in
`docs/` at the root of the autocatalog repository, and the site reads them.

## What is a fact, and what is authored

`owner` is required frontmatter, because a document nobody owns is a document
nobody fixes. `updated` is never authored: it comes from git, per file, so a
freshness date cannot be wrong. Backlinks are derived — "linked from" is computed
across every enrolled repository, so nobody maintains the other end of a link.

Cross-repository links are declared as ids, not paths:

```yaml
---
title: Payments service runbook
owner: Payments
related:
  - acme-handbook/incident-communications
---
```

A relative path into a sibling checkout only resolves for someone who has every
repository cloned side by side. An id resolves anywhere, and a link to a document
that does not exist is a failing check rather than a dead link on a page.

A runbook or ADR is usually about something other than a document, so `about:`
attaches it to that resource, named as `kind/id` the way the catalog already
names it — an Event as `event/<domain>/<id>`, the `domain/id` an Agent's
`consumes` uses:

```yaml
---
title: Payment capture runbook
owner: Payments
about:
  - event/payments/payment.captured
  - service/PaymentService
  - agent/refund-agent
---
```

The document is then listed on that event's and service's pages, the resources
it is about are listed under the document, and `/catalog.json` carries each as a
`describes` edge. `ac docs check` fails a target this repository defines nothing
by, with the near miss it probably meant; a kind the repository defines none of
is left to the composed site, which warns and leaves the edge out.

## Decisions, runbooks and incidents

Architecture decision records, runbooks and incident write-ups live in the
repository they are about, in a folder under its `docs/`:

```text
payments-service/docs/
  adr/0003-kafka-for-payment-events.md
  runbooks/replay-payment-events.md
  incidents/2026-09-14-duplicate-payment-completed.md
```

The folder sets the document's kind, so nobody writes `kind:` by hand. A
document elsewhere can still name one in frontmatter (`kind: incident`), and
the deepest matching folder wins when two kinds nest. A folder's `index.md` or
`README.md` introduces the kind and stays a plain document.

Each kind adds fields to the base contract:

| Kind       | Folder       | Fields                                                                                                                                            |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr`      | `adr/`       | `status` (proposed, accepted, rejected, deprecated, superseded) and `date`, both required; `supersedes` and `supersededBy`, lists of document ids |
| `runbook`  | `runbooks/`  | `severity` (sev1 to sev4) and `lastTested`, a date; both optional                                                                                 |
| `incident` | `incidents/` | `date`, `severity` and `status` (open, mitigated, resolved), required; `rootCause` and `solution`, one sentence each, written once it is resolved |

The ADR states match EventCatalog's. What a document applies to is `about:`,
the same field every document has, so a decision about a service is listed on
that service's page:

```yaml
---
title: Publish payment events on Kafka
owner: payments-platform
status: accepted
date: 2026-03-14
supersedes:
  - payments-service/adr/0001-rabbitmq-for-payment-events
about:
  - service/payments-service
  - event/payment/payment.completed
---
```

An incident keeps its short answers in frontmatter, where the index shows them,
and the full write-up in the body:

```yaml
---
title: Duplicate payment.completed after a consumer rebalance
owner: payments-platform
date: 2026-09-14
severity: sev2
status: resolved
rootCause: The settle step published before committing its offset.
solution: Publishing now happens after the commit.
about:
  - service/payments-service
---
```

`ac docs check` validates each document against the base contract and its
kind's schema together, names the kind in each failure, and checks that every
`supersedes` and `supersededBy` id resolves, as it does for `related`.

### The conventions file

An organisation changes the kinds with one file,
`contracts/autocatalog.conventions.json`, published and found the way the
frontmatter contract is: at the aggregation root, or the one an enrolled
repository (usually the handbook) publishes. Two repositories publishing
different copies is an error that names both files.

```bash
ac docs init-conventions   # write the built-in kinds, then edit them in place
```

```json
{
  "kinds": {
    "runbook": false,
    "adr": { "folder": "decisions" },
    "rfc": {
      "label": "Proposals",
      "folder": "rfcs",
      "path": "proposals",
      "description": "Changes proposed across teams, and what came of them.",
      "columns": ["status", "date", "reviewers", "owner"],
      "statusField": "status",
      "dateField": "date",
      "schema": {
        "type": "object",
        "required": ["status", "date"],
        "properties": {
          "status": { "enum": ["draft", "review", "accepted", "withdrawn"] },
          "date": { "type": "string", "format": "date" },
          "reviewers": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

Each kind takes:

- `label`: the plural the index page, sidebar and home page use.
- `folder`: where its documents sit under `docs/`.
- `path`: its index page, `/<path>/`. Defaults to the label in lower case.
- `description`: the sentence under the index page's title.
- `schema`: JSON Schema for the kind's own frontmatter, checked together with
  the base contract. A base contract closed with `additionalProperties: false`
  still accepts the kind's fields.
- `columns`: the frontmatter fields the index table shows after the title.
- `statusField` and `dateField`: the field shown as a badge and filtered on, and
  the field the index sorts newest first by.

`false` turns a built-in kind off. An object for a built-in kind replaces only
the fields it names, and a field it names replaces the built-in one whole,
`schema` included. A kind's path must not be an enrolled repository's name or
a page the site already publishes, such as `catalog`; the build says which kind
to change.

## The contract is yours

Frontmatter is validated against a JSON Schema the organisation owns, found at
`contracts/docs-frontmatter.json` without a flag. Where the root is a directory
of cloned repositories, as `ac site --topic` builds from, it is the one an
enrolled repository publishes there, usually the handbook:

```bash
ac docs init-schema   # write the default contract, then edit it in place
ac docs check         # frontmatter, cross-repo links, deleted-but-linked docs
ac docs sync-schema   # has this repository's copy drifted from the canonical one?
ac docs manifest      # publish contracts/docs-manifest.json
```

Add a field to that schema and it validates in CI, reaches the page, and can be
enforced from a Python repository that has never installed any of this — because
the contract is JSON Schema, not a plugin API.

A repository committing its own copy of the contract is how CI works without a
sibling checkout, and `ac docs sync-schema` is what keeps the copy honest: the
copy records where it came from in `$id`, the standard keyword for exactly that,
and drift becomes a failing command rather than a surprise.

## What the site adds, and what it refuses to

The site is [Starlight](https://starlight.astro.build) with a plugin. Search,
keyboard navigation, dark mode, translations and accessibility stay Starlight's —
they are not ours to get wrong. The plugin changes where the documents come
from and what the site can derive from the enrolled repositories. Conventional
`events/` and Agent-system directories join the same Repository identity
automatically.

`/catalog` is the human inventory: every Document, Event, Service, Agent, Tool,
Model, Workflow, Policy, Eval, Domain, and Repository with its provenance and
connections. `/catalog.json` publishes the same information as
`autocatalog/graph-v1`. Rich event and agent analysis stays in the deeper domain
shells; this page is the shared navigation layer.

That contract is committed as JSON Schema and shipped with `autocatalog-core`
at `contracts/graph-v1.schema.json`, for the same reason the frontmatter
contract is: a rule that only exists as a TypeScript type cannot be enforced by
a repository that does not run TypeScript.

A repository whose own catalog will not compile is **quarantined**, not fatal.
Its events or agents are left out, the build warns, and `/catalog` names the
repository and the reason. Refusing to publish something partial still holds —
it holds in the repository that owns the mistake, where `ac docs check` and
`ac validate` fail the merge. One team must not be able to take down the index
every other team reads.

It also publishes two things for agents:

- a raw markdown twin at every page's URL plus `.md`
- `llms.txt`, an index of the whole site, linking those twins

Both are generated from the same documents the pages render, so neither can
drift from what a reader sees.

## Using it for your own docs

```bash
pnpm add -D autocatalog-docs-astro
```

```js
import starlight from '@astrojs/starlight';
import autocatalogDocs from 'autocatalog-docs-astro';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Acme docs',
      plugins: [autocatalogDocs({ root: '..' })],
    }),
  ],
});
```

`root: '..'` is the aggregating shape: a docs site in its own repository, reading
the sibling repositories checked out beside it. Point `root` at a directory that
contains `docs/` instead — with `repo` naming it — to publish one repository's
own documentation, which is what this site does.

Leave the sidebar out and it is generated from what is on disk, one group per
repository. Configure a sidebar and yours is kept, which is the right call once a
site has enough pages to need sections.
