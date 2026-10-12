---
name: autocatalog-agents-audit
description: Run the autocatalog-agents audit ruleset against the local catalog and walk the user through fixing each finding. Use when the user says "audit my catalog", "check for issues", "what's wrong with my agents", or invokes /autocatalog-agents-audit. Suitable as a Monday-morning sanity check or a pre-release gate.
---

# /autocatalog-agents-audit

Runs the built-in catalog audit (`ac-agents audit`) and helps the user resolve each finding in order of severity.

## Process

### 1. Find the catalog root

Look upward from the current working directory for a directory containing `agents/` or `tools/` or `policies/`. If multiple candidates exist, ask which to target.

### 2. Run the audit

```bash
pnpm ac-agents audit --root <root> --json
```

Parse the JSON output. Each finding has `rule`, `severity` (P0 | P1 | P2), `ref` (`{ kind, id }` or `null`), `message`, and optional `details`.

### 3. Summarise

Open with a one-line summary: `audit: P0: N  P1: M  P2: K`. If all counts are zero, congratulate the user and stop — the catalog is clean.

### 4. Walk the findings, P0 first

For each finding, in severity order:

- Show the rule, ref, and message.
- Offer the _fix_, not just the diagnosis. Look up the entity file and propose the specific edit:

| Rule                                             | Typical fix                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `high-risk-no-eval`                              | Create `evals/<agent-id>/index.mdx` with `target: <agent-id>` and `cases.yaml`                    |
| `external-write-no-policy`                       | Add a `policies:` entry to the Agent or downgrade the Tool's `side_effects`                       |
| `unestimated-cost`                               | Add `expected_traffic` to the Agent (ask user for invocations/day + avg tokens)                   |
| `agent-without-prompt`                           | Move the system prompt into `agents/<id>/prompts/system.md` and reference it via `prompts.system` |
| `orphan-tool` / `orphan-model` / `orphan-policy` | Confirm with the user: wire it into an Agent, or remove the entity                                |
| `agent-without-domain`                           | Add `domain: <slug>` to the Agent; create the Domain if absent                                    |

Ask before mutating. Batch P2 fixes if the user prefers.

### 5. Re-run

After each batch of fixes, re-run `ac-agents audit` and report the new counts. Repeat until the user is satisfied with the remaining (typically P2) findings.

### 6. Suggest a CI gate

If the catalog now reaches `P0: 0`, suggest wiring `ac-agents audit --fail-on P0` into CI so P0 findings block merges.

## Anti-patterns to refuse

- Don't silence findings by editing rule definitions or the audit source. The audit is the spec; entities must conform.
- Don't fabricate `expected_traffic` numbers — always ask the user for real estimates. Wrong cost data is worse than missing cost data.
- Don't auto-create empty Evals to pacify `high-risk-no-eval`. An Eval with no cases is a worse lie than no Eval.
