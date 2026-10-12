---
title: Agent catalogs
owner: Maintainers
summary: The same idea applied to AI agents — what they call, what they cost, and what they actually did.
tags:
  - agents
related:
  - docs/mcp
  - docs/cli
---

An event catalog documents the messages a system exchanges. An agent catalog
documents the agents that act on it: which tools they call, which model they run,
which policies apply, and what any of it costs.

They run through the same `ac` binary — `ac agents <command>` — over their own
catalog directory. The commands live in `autocatalog-agents-cli`, an optional
install that `ac agents` names if it is missing.

## Seven entity kinds

`agent`, `tool`, `model`, `workflow`, `domain`, `eval`, `policy`. Each is a
document in the catalog, and each declares its references to the others, so
"what breaks if this tool changes" is a question the catalog can answer.

The generated site publishes those entities at `/catalog.json` using the same
`autocatalog/graph-v1` resource contract as Events and Docs. Agent references
become typed edges such as `usesModel`, `usesTool`, `governedBy`, and
`orchestrates`, with source and review evidence preserved on every edge.

An Agent's repository joins the shared graph automatically using the repository
name from its URL. Set `repository.id` when the local Docs or Events repository
uses a different identity; that explicit value overrides the convention.

`starters/agent-default` in the repository is a complete worked example.

## Agents and events

An agent that reacts to an event is a consumer the producing team never listed.
It says so in its own entry, with the event catalog's `domain/id`:

```json
{
  "name": "Triage Agent",
  "model": "claude-haiku-4-5",
  "consumes": [{ "event": "support/ticket.opened", "fields": ["ticketId", "subject"] }]
}
```

Each consumed event is an object. `fields` is optional: the payload paths the
agent reads (`items[].sku` for array items), so `ac drift` can tell it apart
from a change it never sees. Leave it out and every change to the event counts
as reaching the agent.

Tools take `produces` and `consumes` too: `issue-refund` produces
`payments/refund.issued`. `produces` is a plain list of events, since a
producer emits the whole payload. A bare id (`ticket.opened`) works while only
one domain has it; once a second domain does, validation asks for `domain/id`.

With `events/` next to the agent catalog, as a repository enrolled in the index
has it, the link runs both ways:

- `ac agents validate` fails on an event that does not exist, and suggests the
  one you probably meant. With no event catalog to check against, it says the
  references went unchecked rather than passing them. `--events <dir>` points it
  at one elsewhere.
- `ac drift`, and the event MCP server's `assess_impact` and `check_change`,
  name `agent/triage-agent` among the consumers a change breaks.
- `ac agents impact event/support/ticket.opened` lists who produces and consumes
  the event, including agents that only reach it through a tool they call.

In the company index the agent can live in a different repository from the
event. The edge lands on the exact event, preferring the copy in the agent's own
repository, and the event's page lists it. An agent catalog naming an event no
repository publishes is quarantined with the reason, like any other broken
reference.

## Commands

```text
ac agents validate <root>                 Validate a catalog directory, and its event references
ac agents impact <kind>/<id>              What this depends on, and what depends on it
ac agents impact event/<domain>/<id>      Which agents and tools produce or consume an event
ac agents search <query>                  Substring search across every entity
ac agents cost [<agent>]                  Cost estimate, or a rollup
ac agents audit                           Run the audit ruleset
ac agents drift <otlp-file>               Compare observed behaviour against the catalog
ac agents discover --from <framework>     Infer draft entries from source code
ac agents llmstxt                         Emit llms.txt for the catalog
ac agents mcp                             Start the stdio MCP server
```

Every command takes `--root <path>` to point at the catalog.

**Impact** answers the blast-radius question directly:

```bash
ac agents impact agent/refund-agent --root starters/agent-default
```

**Cost** estimates from the declared model and usage, and rolls up
`--by-domain`, `--by-owner`, or `--by-model` — the three ways somebody actually
asks where the spend went.

**Audit** runs a ruleset over the catalog and exits non-zero when findings cross
a threshold: `--fail-on P0` in CI keeps the worst class of problem out of the
default branch. `--json` for machine-readable output.

**Drift**, here, compares what agents _did_ against what the catalog _says_. Feed
it an OTLP JSON export of real traces and it reports the tools called that no
entry declares:

```bash
ac agents drift ./traces.json --root ./catalog
```

**Discover** reads framework source — `--from pydantic-ai` or `--from ai-sdk` —
and infers draft entries, so an existing codebase gets a first catalog without
anyone hand-writing one. `--dry-run` prints what it would create.

## For coding agents

`ac agents mcp` starts an MCP server over the agent catalog, and
`ac agents llmstxt` emits the whole catalog as `llms.txt` for clients that only
read URLs. Same posture as the [event MCP server](/docs/mcp): free, local, stdio.

The generated Agents site also has `/assistant`: a BYOK browser chat that calls the
same tools (impact, cost, audit, search) against the published snapshot. Prefer MCP
when a coding agent is doing the asking; the page is for humans poking at a catalog
without installing anything.
