---
name: autocatalog-docs
description: Write or update documentation from source, in the repository that owns the code, against the company's committed frontmatter contract. Use when the user asks to document a service, write a runbook, record how something works, fix a failing `ac docs check`, or when a change to code leaves its documentation wrong.
---

# /autocatalog-docs

Documentation lives in the repository it describes, under `docs/`, and is reviewed in the pull request that changes the behaviour. The company index is built from those files — nothing is authored in the index.

Your job is to write what the code actually does, in a file that satisfies a contract this organisation owns.

## 1. Read the contract before writing a single line of frontmatter

The frontmatter rules are **not** in this skill. They are a committed JSON Schema, and every organisation's is different.

```bash
ac docs check
```

Its last line names the contract in force:

- `contract: contracts/docs-frontmatter.json` — read that file. Its `required` array is what you must write; its `properties` is what you may write. Where a property has an `enum`, use one of those values exactly and never invent a new one.
- `contract: built-in default` — only `title` and `owner` are required. Mention to the user that `ac docs init-schema` writes a contract they own, but do not run it unprompted: the contract is a company-wide decision, not a side effect of writing one document.

If `additionalProperties` is `false`, a field the contract does not declare will fail the check. Ask before proposing a contract change.

## 2. Put the file in the repository that owns the code

`<owning-repo>/docs/<path>.md`. The id readers and links use is derived from that path — `payments-service/docs/ops/replay.md` is `payments-service/ops/replay` — so the path is the URL and the permanent name. Choose it once, deliberately.

Never write documentation into the aggregating site's repository. A document there has no owning team and no code to stay true to.

## 3. Write from the source, not from the summary

Read the code, the tests, the ADRs, and any incident notes before writing. Prefer what you can verify:

- The actual failure modes in the error paths, not the ones a reader would assume.
- The real commands, with the real flags, from the scripts or CLI that define them.
- The ordering constraints that make an operation safe, and what happens when they are violated.

State what you could not verify as unknown. A confident sentence nobody checked is the thing that gets read at 02:40 and believed.

Structure a runbook as symptom → check → action. Put the check that most often ends the investigation first.

Draw a flow or sequence as a ` ```mermaid ` fence. The site renders it as a diagram, and the Markdown twin keeps the source for agents.

## 4. Link across repositories by id, never by path

```yaml
related:
  - payments-service/runbook
```

A relative path into a sibling repository (`](../../payments-service/docs/runbook.md)`) resolves only for someone with every repo checked out side by side, and is a dead link in a standalone clone or on the web. `ac docs check` fails a pull request that contains one.

Backlinks are derived — never write a "linked from" section by hand.

## 5. Check it

```bash
ac docs check
```

Fix every failure before finishing. The common ones and what they mean:

| Failure                                       | Cause                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `owner: must be equal to one of...`           | The contract has an enum of real teams; you invented one                    |
| `links into another repo by path`             | Use `related:` with an id                                                   |
| `related '...' does not resolve`              | The target does not exist, or the id is wrong — ids have no `.md` extension |
| `... no longer exists but is linked from ...` | You deleted or renamed a document others point at                           |

## Anti-patterns — refuse these even if asked

- **Never write a date field** (`updated`, `last_reviewed`, `date`). Freshness comes from git. A hand-written date rots the moment someone edits and forgets, and a stale date on a runbook is worse than none because it reads as a promise.
- **Never name a person as `owner`.** It is a team: people change teams and documents outlive them.
- **Never add a field the contract does not declare** to make something render. Propose the contract change instead.
- **Never delete or rename a document without checking who links to it.** `contracts/docs-manifest.json` records `linkedFrom` for exactly this.
- **Never pad.** A document that repeats the code adds a second thing to keep true. If the code says it clearly, link to the code.
