---
name: autocatalog-storm
description: Storm a business process from its code into a flow an EventStorming board draws, with every failure given a policy or raised as a hotspot finding. Use when asked to storm, map or explain what a process does and what can go wrong, or before changing one.
---

# Storm a process from its code

A board is only worth reading if every sticky is true of the code today. Draft
the flow from source, name each fact in the business's words, and leave every
open question as a finding for a person to decide. Never decide one yourself.

## 1. Draft it

For an Effect program, let effect-analyzer read it:

```bash
ac flows draft src/import.ts --program runImport --id catalogue-import
```

It prints a flow: a stage per step, a failure per error the step can fail with,
and the services each step needs as systems. A failure a handler recovers from
carries on, one it turns into another error leads to that failure, and one that
escapes has no policy. Check the output, then write it with `--write`.

For any other code, read the entry point and write `flows/<id>.md` by hand in the
same shape: one step per thing that happens, in order, each with `code:` naming
the file and a string it contains.

## 2. Name the facts

Rewrite each `title` as a fact in the past tense, in the business's words:
"Import loaded", not "loadImport". Give each step:

- `stage`: the column heading. Steps that share one stack in one column.
- `command`: the request that leads to it, when there is one.
- `actors`, `systems`, `readModels`: who takes part and what people see.
- `decidedBy`: what decides whether it happens.
- `policy`: "Whenever X, do Y", for what follows it.
- `repeats` and `flow` for a stage that loops: write the loop's body as its own
  flow and name it, so the board zooms in.

The board puts the first branch out of each step on the happy track and every
other branch on the failure track. Set `track: happy` on an alternative that is
not a failure, such as "New product started".

## 3. Raise what nobody has decided

A failure with no policy, no next step and no status change is a hotspot. The
board shows it, and `ac docs check` warns. Do not invent a policy to silence it.
Write a finding the team can decide on:

```markdown
---
title: Missing import or supplier vanishes silently
owner: Catalogue
nature: question
status: draft
date: 2026-11-09
flow: catalogue-import
step: import-not-found
---

What the code does today, and the decision it needs.
```

Where the docs and the code disagree, say so in a finding. Add `scenarios:` to
the flow for each case worth testing; where today's behaviour is not what should
happen, put that in `expected`.

## 4. Check it

```bash
ac docs check .
ac flows verify .
```

`docs check` fails a flow that does not hold together and warns about each
unhandled failure. `flows verify` checks each step's code is still there.

## Anti-patterns

- Writing a policy the code does not have, so the board looks finished.
- Marking a finding `confirmed` yourself. A person confirms it.
- Naming facts after functions ("downloadFile completed").
- Leaving `code:` off a step, so nothing checks it against the code.
- Folding a loop's body into the outer flow instead of zooming into its own.
