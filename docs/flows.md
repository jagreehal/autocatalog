---
title: Flows and evidence
summary: Write down how the system behaves, and see what backs each claim.
owner: Maintainers
tags:
  - reference
related:
  - docs/quick-start
  - docs/cli
  - docs/docs-convention
---

Most of what a company knows about how its system behaves sits in tickets and in
people's heads. Autocatalog gives that knowledge a home in the repository, and
compares it with the code and with what ran. Your system does not need to be
event-driven: a status written to a database is enough to start.

Three things stay separate:

| Term                  | Means                                    | Example                  |
| --------------------- | ---------------------------------------- | ------------------------ |
| Business event        | Something meaningful happened            | Capture started          |
| Expected transition   | The model says this change should happen | `authorised → capturing` |
| Observed state change | A system recorded this change            | a persisted status write |

A status can be wrong. It can say `capturing` after the work has died, so a recorded
change shows what was written, not what happened.

## After an investigation

Write what you learned as a finding, in `docs/findings/`:

```markdown
---
title: Investigating a capture potentially stuck in capturing
owner: Payments
ticket: SUP-1042
entity: payment
nature: question
status: draft
date: 2026-11-06
flow: capturing-a-payment
step: started
---

## What was seen

## What was happening

## How to spot it

## How to recover
```

`nature` is `behaviour`, `defect` or `question`. `status` is the state of the
knowledge: `draft`, `confirmed` or `superseded`. A defect's own workflow stays in
your tracker. Add `resolved` with the fix or the answer, and the map stops warning.

Keep the ticket id and the system's behaviour. Leave out customer names, emails, bank
details, real transaction values and pasted records, because a finding reaches the
site, `llms.txt` and MCP. Synthetic amounts and business thresholds are fine.

Any kind of document can attach to a flow with `flow:` and `step:`, including kinds
you define in [the conventions file](/docs/docs-convention#the-conventions-file). A
`flow:` is a flow's id, or `<repository>/<id>` for one another repository keeps.

## Model the states

An entity names the states each field moves through. One entity can have several
lifecycles, so they are keyed by field:

```yaml
---
name: Payment
lifecycles:
  status:
    states: [authorised, capturing, captured, failed]
    initial: authorised
    terminal: [failed]
---
```

A flow names what its steps change. A step can override `entity` and `field`:

```yaml
---
title: Capturing a payment
entity: payment
field: status
steps:
  - id: started
    title: Capture started
    transition: { from: authorised, to: capturing }
    code:
      - { file: src/capture.js, contains: "status: 'capturing'" }
    rules:
      - A payment is captured once
      - { text: Retries are safe, test: test/capture.test.js }
    stuck:
      signs: status is capturing and no capture task is running
      recovery: docs/runbook.md
    next_steps:
      - { id: captured, label: the network accepts }
      - { id: lookup-failed, label: the fee lookup fails }
  - id: lookup-failed
    title: Fee lookup failed, capture continues
    next_step: captured
  - id: captured
    title: Payment captured
    transition: { from: capturing, to: captured, via: worker }
---
```

`from` takes one state or a list. A step needs no transition, because a failure can
change nothing the lifecycle tracks. `stuck` is prose: nothing times it.

Two steps can share a transition and mean different things. If an operator can set
`captured` to release a payment, that is its own flow with its own entry point, and
`via` tells the two apart. `ac docs check` fails a transition using a state the
lifecycle lacks, and warns about a non-initial state no flow reaches.

## What verified means

There is no overall status, because each kind of evidence proves something different:

| Evidence         | Establishes                     | Does not establish                    |
| ---------------- | ------------------------------- | ------------------------------------- |
| Schema           | A state is defined              | That anything can reach it            |
| Code link        | The linked code is there        | That the transition succeeds          |
| Production count | A transition was recorded       | That it happened for the right reason |
| Linked test      | It worked under test conditions | That production always behaves so     |

```bash
ac flows verify --observed transitions.json --write
```

This writes `flows/evidence.json`, with the commit checked and the observation window,
and the flow's page shows each dimension. Evidence over 30 days old reads as old.

- `not observed` means it was instrumented and nothing was recorded in the window.
- `not instrumented` means nothing was watching. Both describe coverage, so read them as gaps in evidence.
- A rule in prose stays `not checked`. A rule with a test reads `test linked`.
- A step with a `via` counts only that `via`. Database-only observation reports
  `unknown`, so it is shown beside the step and never credited to it.
- Anything recorded that no flow declares is listed.
- A step edited since the check reads `not checked` until you run it again, because
  the old results were about a different claim.

The command exits 1 only when a claim is contradicted: a state outside the lifecycle or
schema, or code that is gone.

## Runtime evidence through MCP

[autotel](https://github.com/jagreehal/autotel)'s `transition()` counts persisted
transitions, without depending on trace sampling. Its MCP server reads them back with
`get_state_transitions`, which returns the file `--observed` takes. Counts are
best-effort evidence, not an authoritative number.

To investigate, an agent asks `flow_context` for the flow, then reads each transition
with the `observe` hints it returns. That is exploration: the agent explains the
record, and `ac flows verify` decides what counts as a match. Draft findings and
questions come with their status, so an agent can tell a hypothesis from a fact.
