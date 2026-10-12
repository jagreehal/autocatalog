---
name: autocatalog-agents-add
description: Add a new entity (Agent, Tool, Model, Workflow, Domain, Eval, or Policy) to the autocatalog-agents. Use when the user says "add an agent", "register a tool", "document a new policy", or similar. Walks the user through the right frontmatter, places the file in the right directory, and runs `ac-agents validate` afterward.
---

# /autocatalog-agents-add

Adds a new entity to the local autocatalog-agents catalog. The catalog root is typically `starters/agent-default` in development, or the directory containing top-level `agents/`, `tools/`, `models/`, `workflows/`, `domains/`, `evals/`, `policies/` in a user project.

## Process

### 1. Find the catalog root

Look upward from the current working directory for a directory containing at least one of: `agents/`, `tools/`, `policies/`. If multiple candidates exist, ask the user which to target.

### 2. Ask which entity kind to add

Use `AskUserQuestion` to offer the 7 kinds: Agent, Tool, Model, Workflow, Domain, Eval, Policy. Brief explainer per option (one line each — see `CONTEXT.md` in the catalog root for the canonical definitions if present).

### 3. Gather the minimum required fields per kind

| Kind     | Required                                    |
| -------- | ------------------------------------------- |
| Agent    | id, name, owner, model, tools[], policies[] |
| Tool     | id, name, owner, side_effects               |
| Model    | id, name, owner, provider, model_id         |
| Workflow | id, name, owner, agents[]                   |
| Domain   | id, name, owner                             |
| Eval     | id, name, owner, target (Agent id)          |
| Policy   | id, name, owner                             |

Validate referenced IDs against the existing catalog _before_ writing — read the relevant subdirectory and confirm every referenced ID exists. If not, offer to either fix the reference or stub the missing entity.

For an Agent or Tool, also ask which events it **produces** or **consumes**, and write them using the event catalog's `domain/id`: `produces: ['payments/refund.issued']`, and `consumes: [{ event: 'payments/refund.issued', fields: ['amount'] }]` — `fields` (the payload paths it reads) only when the user knows them. Take the ids from the `events/` catalog next to the agent catalog, or from the event MCP server (`list_events`) — never invent one. This is how the event side learns the agent exists: without it, a breaking change to that event will not name the agent.

### 4. Write the file

- For Models: a single YAML file at `models/<id>.yaml`.
- For everything else: `${kind}s/<id>/index.mdx` with frontmatter + an optional one-line description in the body.
- For Agents: also offer to create `agents/<id>/prompts/system.md` and reference it via `prompts.system: ./prompts/system.md`.

### 5. Validate

Run `ac-agents validate <root>` from the repo root. If it exits non-zero, surface the issues and offer to fix. It checks event references against `<root>/events` (or `--events <dir>`); if it reports them as **not checked**, say so to the user instead of calling the entity valid.

### 6. Suggest follow-ups

- For Agents/Tools/Policies: recommend running `ac-agents impact <kind>/<id>` so the user can see the new entity's place in the graph.
- For Agents: suggest adding an Eval that targets it.

## Anti-patterns to refuse

- Don't invent entity kinds. The seven are fixed (see CONTEXT.md if present).
- Don't add `Skill`, `MCPServer`, or `KnowledgeBase` as first-class; fold them into existing tags/attributes.
- Don't write a file at the catalog root or into an unexpected directory.
