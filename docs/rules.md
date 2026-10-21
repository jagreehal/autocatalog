---
title: Catalog rules
owner: Maintainers
summary: Your own architecture checks, run by the drift gate on what each pull request changes.
tags:
  - ci
related:
  - docs/drift-ci
  - docs/runtime-evidence
---

`ac drift` knows what breaks a consumer. Your organisation also has rules of
its own: public events need owners, deprecated events gain no new consumers,
payment data stays inside its domain. Write each one as a rule, and the drift
gate checks it on every pull request, in the same report.

## Write a rule

Put one rule per file in `contracts/rules/`, named `*.rule.mts` (or `.ts` and
`.js` in a package with `"type": "module"`, or `.mjs`). File names use letters,
digits, `.`, `_` and `-`. The default export is the rule:

```ts
// contracts/rules/events-have-owners.rule.mts
import type { CatalogRule } from 'autocatalog-core';

export default {
  id: 'events-have-owners',
  name: 'Every event has an owner',
  severity: 'breaking',
  run: ({ current }) =>
    current.resources
      .filter((resource) => resource.ref.kind === 'event' && !resource.owner)
      .map((resource) => ({
        message: 'no owner',
        resource: resource.ref,
        suggestion: 'Add its folder to CODEOWNERS',
      })),
} satisfies CatalogRule;
```

`run` gets the catalog as a resource graph (`autocatalog/graph-v1`): every
event, service, command, datastore and document, with owners, provenance,
runtime evidence and the relationships between them. Each event's
`attributes.payloadSchema` is its JSON Schema, so a rule can check its fields. `current` is the catalog
the change leaves. `base` is the catalog before it, so a rule can look at the
change itself:

```ts
// contracts/rules/deprecated-events-gain-no-consumers.rule.mts
import type { CatalogRule } from 'autocatalog-core';

const consumers = (graph, key) =>
  new Set(
    graph.relationships
      .filter((r) => r.type === 'consumes' && `${r.from.namespace}/${r.from.id}` === key)
      .map((r) => r.to.id),
  );

export default {
  id: 'deprecated-events-gain-no-consumers',
  name: 'A deprecated event gains no consumers',
  run: ({ current, base }) =>
    current.resources
      .filter((e) => e.ref.kind === 'event' && e.attributes.status === 'deprecated')
      .flatMap((e) => {
        const key = `${e.ref.namespace}/${e.ref.id}`;
        const before = base ? consumers(base, key) : new Set();
        const added = [...consumers(current, key)].filter((c) => !before.has(c));

        return added.map((c) => ({ message: `${c} started consuming it`, resource: e.ref }));
      }),
} satisfies CatalogRule;
```

Node runs a TypeScript rule as it is, with its types stripped, so keep to syntax
Node can strip: no `enum` and no parameter properties. A rule imports types
only (`import type`). It runs with no packages: the installed ones come from the
pull request, which could change what they do, so a rule that imports one at run
time fails as `rule_failed`. Keep each rule to plain code over the graph.

## Run them

Rules are code from the repository, so `ac drift` runs them only with
`--allow-code-execution`:

```bash
ac drift --base-ref origin/main --root . --format github --allow-code-execution
```

Each rule runs in its own Node process with the permission model on. It can
read only the base branch's copy of the repository, gets no environment beyond `PATH`, and
stops after 30 seconds. A rule that throws, times out or returns something
other than violations fails the gate as `rule_failed`. The gate never reads a
rule that did not run as a rule that passed.

`ac drift --base-ref` runs the rules and `rules.json` as the base branch has
them, so a pull request cannot loosen the policy it is checked against. A rule
a pull request adds or changes takes effect once it merges. Comparing two
directories with `--base` and `--current` runs no rules, because neither tree
is the trusted one. Give `contracts/rules/` an owner in CODEOWNERS.

## Only what the change introduced

`ac drift` runs each rule twice: on the catalog before the change and on the
catalog after it. A violation the base already had stays in the report as
info, so a new rule reports the existing gaps without failing every open pull
request. The gate fails on the violations the change adds.

## Severities and exceptions

A rule's `severity` is `breaking` (the default), `suspicious` or `info`, and
gates with `--fail-on` like any other finding. `contracts/rules/rules.json`
changes a severity without touching the rule, and lists the resources a rule
skips:

```json
{
  "severity": { "events-have-owners": "suspicious", "pii-stays-in-domain": "off" },
  "except": { "events-have-owners": ["event:payments/legacy.*", "event:sandbox/*"] }
}
```

An exception names a resource by `kind:namespace/id`, and `*` matches any
run of characters. Start a strict rule as `suspicious`, fix what it finds, then
raise it.

## In the report

A violation reads `Rule name (rule-id): message. suggestion`, filed under the
resource it names. The report strips backticks, brackets, `@` and markup from
rule output, so a rule cannot mention people or embed links in a pull request
comment.
