---
title: Writing docs that stay true
owner: Reliability
tier: standard
summary: The four rules every enrolled repository follows.
tags:
  - policy
---

# Writing docs that stay true

Documentation lives in the repository it describes, under `docs/`, and is
reviewed in the pull request that changes the behaviour. The index you are
reading is built from those files; nothing is authored in the index itself.

## Four rules

1. **Frontmatter carries `title` and `owner`.** The owner is a team, not a
   person, because people change teams and documents outlive them.
2. **Never write a date.** Freshness comes from git. A hand-written date rots
   the moment someone edits the file and forgets it, and a stale date on a
   runbook reads as a promise.
3. **Link across repositories by id, in `related`.** Never by relative path.
4. **Delete what is wrong.** A deleted document is honest; a wrong one is not.

## Why rule three exists

A path into a sibling repository resolves only for someone who has every repo
checked out side by side. In a standalone clone, and on the web, it is a dead
link:

```md
See [the runbook](../../payments-service/docs/runbook.md).
```

Declare the edge instead, and the index resolves it wherever it is read:

```yaml
related:
  - payments-service/runbook
```

`ac docs check` fails a pull request that uses the first form, and fails one
that deletes a document other repositories still link to.
