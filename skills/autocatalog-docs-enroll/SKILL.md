---
name: autocatalog-docs-enroll
description: Enrol a repository into the company documentation index, or stand that index up for the first time. Use when the user asks to set up autocatalog docs, add a repo to the docs site, wire the docs check into CI, or start a company documentation index.
---

# /autocatalog-docs-enroll

Two different jobs share this name. Establish which one before touching anything:

- **A repository joining the index.** Common, done once per repo, by the team that owns the code.
- **Standing up the index itself.** Done once for the organisation, and it decides the contract every other repo will be held to.

If the working directory contains application code, it is A. If it is a fresh or site-only repository meant to aggregate others, it is B. When genuinely ambiguous, ask — getting this backwards creates a rival contract that other repos then have to reconcile.

## Path A — enrol a repository

### 1. Create the root

```bash
mkdir -p docs
```

`docs/` at the repository root. Nothing else is configuration: the shape is detected from disk.

### 2. Find out which contract applies

```bash
ac docs check
```

If it reports `contract: built-in default`, the organisation's contract is not visible from here. **Do not run `ac docs init-schema` to fix that.** In a publishing repository that creates a second, rival contract, which is how an organisation ends up with forty dialects of the same frontmatter. Instead, pick one:

| Situation                                        | Do                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| The contract repo is checked out beside this one | `ac docs check --schema ../<handbook>/contracts/docs-frontmatter.json`  |
| It is not, and CI runs this repo alone           | Commit a copy at `contracts/docs-frontmatter.json` — see below          |
| The organisation has no contract yet             | Use the default, and raise standing one up (Path B) as its own decision |

A committed copy drifts the day the organisation edits the original, so do not leave it unguarded:

```bash
ac docs sync-schema
```

It reads the `$id` the copy records, compares it with the canonical contract, and exits non-zero when they differ — naming what changed, and flagging a newly required field first because that is what breaks a build that passed this morning. `ac docs sync-schema --write` takes the upstream version; run `ac docs check` straight after, because a stricter contract can invalidate documents that were fine.

If the copy has no `$id`, the organisation has not published the contract at a URL yet. Say so rather than inventing one.

Keep this out of the pull-request check: `ac docs check` must work offline and on every commit, while syncing reaches the network. A scheduled job, or a step before release, is the right home.

### 3. Write the first document

Use `/autocatalog-docs`. One real document beats a scaffolded placeholder — a `docs/README.md` saying "documentation goes here" is a file that will never be deleted.

### 4. Make it a gate in this repository's own CI

A publishing repo should not learn its documentation is broken from the aggregator's build, hours later and in someone else's pipeline.

```yaml
- name: Check documentation
  run: npx ac docs check
```

Run it on pull requests. It exits non-zero on invalid frontmatter, on a relative link into another repository, and on deleting a document other repositories still link to.

### 5. Confirm

```bash
ac docs check
```

Green, and the contract line names what you expect.

## Path B — stand up the index

### 1. Own the contract

```bash
ac docs init-schema
```

Commit `contracts/docs-frontmatter.json`, then edit it: turn `owner` into an `enum` of real teams, add the fields the organisation actually needs, and close it with `"additionalProperties": false` once the shape is known. This file is the decision every enrolled repository inherits, so agree it with the people who will have to satisfy it.

Set `$id` to the URL this file is served from. That is the standard JSON Schema keyword for where a schema is published, and it is what lets every repository that copies the contract run `ac docs sync-schema` and find out when it has moved on.

### 2. Build the site

A Starlight site with the plugin — `autocatalog-docs-astro` — whose `root` points at wherever the repositories are checked out. Its README has the two files required. Do not copy anyone's documentation into this repository; it reads theirs where they wrote it.

### 3. Publish the index other repositories check against

```bash
ac docs manifest
```

This writes `contracts/docs-manifest.json`: what exists, and who links to what. Cross-repository links stay unchecked until you publish it, which suits the first repository and needs closing once a second one enrols. Run it in the site's build. A site built with `ac site` serves the file at `/contracts/docs-manifest.json` already, so skip this step there.

### 4. Confirm

```bash
ac docs check
```

Across every enrolled repository, against the contract, with links resolved.

## Anti-patterns — refuse these even if asked

- **Never enrol a repository by copying its documentation into the index.** The copy stops being true on the next deploy, and the team that owns the code no longer owns the words.
- **Never run `ac docs init-schema` in a publishing repository** when the organisation already has a contract. One contract, many repositories.
- **Never scaffold placeholder documents** to make the index look populated. An empty `docs/` is honest; a directory of "TODO" is a lie with a longer half-life.
- **Never enrol without the CI step.** An unchecked repository is where the first broken link comes from, and nobody finds it until a reader does.
- **Never invent a `docs/` layout convention** — subdirectories are free, but the root is `docs/`, and the path is the permanent id.
