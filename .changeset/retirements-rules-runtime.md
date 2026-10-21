---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-core': minor
---

Retirements, meaning checks, catalog rules and runtime evidence.

- `ac retire <event> [field]` says whether a field or event can go yet, consumer by consumer, from declarations, snapshots and pacts. The site's Retirements page tracks each deprecated event and field.
- `x-meaning` declares a field's unit, currency or timezone, and `ac drift` fails a change to it.
- Catalog rules in `contracts/rules/` run from the base branch with `ac drift --base-ref --allow-code-execution` and gate on the violations a change adds.
- `ac drift --snapshot` checks payload types and enums, and names undeclared producers and channels.
- `ac from-snapshot` drafts contracts from an autotel snapshot.
- Site maps show what ran on each edge, with Replay and Live modes (`ac site --live-url`).
- Document kinds for ADRs, runbooks and incidents, and pages for Prisma, Drizzle and Mongoose models.
- A living map home page, JetBrains Mono and a blueprint palette.
