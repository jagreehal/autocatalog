# autocatalog-docs-core

Aggregate repository-owned `docs/` roots into one validated, linkable index.

Teams keep authorship in git, beside the code the document describes. Readers
get a company index. Nothing has to move into a wiki.

```bash
ac docs init-schema  # write contracts/docs-frontmatter.json, then edit it
ac docs check        # validate frontmatter and cross-repo links, for CI
ac docs manifest     # publish contracts/docs-manifest.json
```

## The contract is yours

Consistent frontmatter across every repository is the whole point, so the
contract is a **committed JSON Schema that the organisation owns**, not
something this package decides.

```bash
ac docs init-schema   # writes the default into contracts/docs-frontmatter.json
```

Commit that file and edit it in place. Everything reads it from there with no
flag — `ac docs check`, `ac docs manifest`, and the site build:

| Want                     | Do                                                           |
| ------------------------ | ------------------------------------------------------------ |
| A field of your own      | Add it to `properties`, and to `required` if it is mandatory |
| Only real team names     | Make `owner` an `enum` of your teams                         |
| A controlled vocabulary  | `enum` on any field: tiers, lifecycles, classifications      |
| No stray keys            | `"additionalProperties": false`                              |
| Different rules per repo | Point `--schema` at a different file                         |

Editing one file beats layering a default and an override: nobody has to reason
about merge order, and the result is plain JSON Schema — which is also what lets
a Python repository enforce the same rules with `jsonschema`, importing nothing
from here.

Nothing is required to start: with no contract committed, a built-in default
requiring `title` and `owner` applies, and `ac docs check` says which contract
it used — whether it passed or failed.

### Repositories that keep a copy

A repository running its own CI needs the contract locally, and a committed copy
drifts the day the organisation edits the original. Give the canonical contract
an `$id` — the standard JSON Schema keyword for where a schema is published —
and every copy can check itself:

```bash
ac docs sync-schema           # exits non-zero when the copy has drifted
ac docs sync-schema --write   # take the upstream version
```

It names what changed, newly-required fields first, because those are what break
a build that passed this morning. Keep it out of the pull-request check:
`ac docs check` must work offline on every commit, while this reaches the
network, so it belongs in a scheduled job or a pre-release step. A sync that
cannot reach the source fails — it has verified nothing, and saying otherwise
would make the command worthless.

A field your contract declares also survives into the site's page data, so
[autocatalog-docs-astro](../astro/README.md) can show it. A field nobody
declared is validated by nothing and shown by nothing.

## What else it enforces

- **No relative links into sibling repositories.** `](../../other-repo/...)`
  resolves only for someone with every repo checked out side by side, and is a
  dead link in a standalone clone. Declare `related: [other-repo/doc]` instead.
  Fenced code blocks are exempt, so a document can teach the rule by showing the
  wrong form.
- **Declared links resolve.** Documents in this checkout resolve against the
  filesystem; cross-repo targets resolve against the published index. Before an
  index exists they go unchecked, because failing there would stop the first
  publisher ever linking out.
- **Renames do not silently break readers.** The index records `linkedFrom`, so
  deleting a document that others point at fails the pull request that did it.

## Freshness comes from git

`updated` is the last commit touching the file. It is never a frontmatter field:
a hand-written date rots the moment someone edits and forgets, and a stale date
on a runbook is worse than none because it reads as a promise. When git cannot
answer — no repository, uncommitted file, shallow clone — it is `null` and
renders as unknown rather than invented.

## Both shapes, no configuration

The same call works for a company index aggregating many sibling repositories
and for one repository checking its own `docs/` in its own CI. It detects which
by looking for `<root>/docs`; `--repo` names the single-repo case explicitly.

## Reading surface

This package is framework-free on purpose: the checker has to run in a
repository's CI with no Astro installed. To publish the documents as a site,
add [autocatalog-docs-astro](../astro/README.md) — a Starlight plugin that
points Starlight's own pages, navigation and search at every enrolled
repository, and adds raw markdown twins and `llms.txt`.

## API

```ts
import { readDocs, buildDocsManifest, checkDocs } from 'autocatalog-docs-core';

const result = checkDocs(root); // { failures, docs, repos, ... }
const manifest = buildDocsManifest(root); // refuses to publish if any doc is invalid
```
