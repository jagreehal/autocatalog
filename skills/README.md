# autocatalog skills

Claude Code skills that teach an AI coding agent to document a codebase the way this tool expects: **from source, against the contract your organisation owns, and checked before it is called done.**

An agent writing documentation is fast and confident, which is exactly the problem. These skills bind that speed to the same rules a human reviewer would enforce — the frontmatter contract, no hand-written dates, no cross-repo paths, no hand-edited generated files — and end every workflow on a command that fails if the agent got it wrong.

## Bundled skills

- [`autocatalog-docs`](./autocatalog-docs/SKILL.md) — write or update documentation from source, in the repository that owns the code, against the committed frontmatter contract
- [`autocatalog-docs-enroll`](./autocatalog-docs-enroll/SKILL.md) — join a repository to the company index, or stand that index up for the first time
- [`autocatalog-bootstrap`](./autocatalog-bootstrap/SKILL.md) — stand a catalog up on a repository that never had one, by fixing the source until the scan is true
- [`autocatalog-scan`](./autocatalog-scan/SKILL.md) — generate an event catalog from a codebase, then review what was extracted versus inferred
- [`autocatalog-drift`](./autocatalog-drift/SKILL.md) — find out who a schema change breaks before making it
- [`autocatalog-investigate`](./autocatalog-investigate/SKILL.md) — connect catalog impact and compatibility with runtime investigation through autotel-mcp
- [`autocatalog-impact`](./autocatalog-impact/SKILL.md) — ask who a contract change reaches, over MCP, before writing the edit
- [`autocatalog-agents-add`](./autocatalog-agents-add/SKILL.md) — add an Agent, Tool, Policy, or other entity to an agent catalog, with edge validation
- [`autocatalog-agents-audit`](./autocatalog-agents-audit/SKILL.md) — run the audit ruleset and fix each finding in severity order

## Installing

```bash
npx skills add jagreehal/autocatalog
```

Or one skill: `npx skills add jagreehal/autocatalog --skill autocatalog-docs`. Then invoke it from your agent, e.g. `/autocatalog-docs`.

## Layout

Each skill is a directory here with a `SKILL.md`. Keep them here rather than under `.claude/skills/` or `packages/*/`, so skills.sh and agent installers find them. `skills.sh.json` at the repository root groups them on skills.sh; it does not affect installation.

## Why the contract is read at runtime

`autocatalog-docs` deliberately does not list the frontmatter fields. It runs `ac docs check`, reads the contract that command names, and writes frontmatter satisfying _that_ — including honouring `enum` values, so an agent picks a real team name instead of inventing a plausible one.

A skill with the fields baked in would be wrong at every company but one, and stale at that one the first time it edited its own schema.

## These skills are tested

`packages/events/cli/test/skills.test.ts` parses every `ac …` command out of every skill and asserts it against the real CLI in `autocatalog-cli`. A renamed command or a dropped flag fails the build rather than quietly teaching every agent a command that no longer exists.
