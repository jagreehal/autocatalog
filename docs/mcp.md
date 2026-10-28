---
title: MCP for coding agents
owner: Maintainers
summary: Thirteen tools that let an AI coding agent query the catalog, ask what a change breaks, and draw the architecture in the conversation.
tags:
  - agents
  - reference
related:
  - docs/agents
  - docs/docs-convention
---

Autocatalog ships an MCP server. Any MCP client — Claude Code, Cursor, Windsurf —
can query the event catalog without being handed a copy of it in a prompt.

It is MIT, like everything else here. There is no tier in which the agent surface
costs money.

## Configuration

```json
{
  "mcpServers": {
    "autocatalog": {
      "command": "node",
      "args": ["node_modules/autocatalog-mcp/dist/index.js", "--root", "."]
    }
  }
}
```

The server loads events through `autocatalog-core`'s `loadCatalog()`, writes
status to stderr, and speaks over stdio. No network access is involved.

## The tools

| Tool                       | Answers                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `list_events`              | What events exist, optionally in one domain                           |
| `describe_event`           | Everything about one event: metadata, schema, examples, body          |
| `get_schema`               | The JSON Schema for an event                                          |
| `get_examples`             | Example payloads, optionally filtered by name                         |
| `search`                   | Free text across ids, names, summaries, producers, consumers and tags |
| `find_by`                  | Events matching an attribute value: domain, status, tags, producers   |
| `search_fields`            | Which events carry a field path, who it reaches, and type conflicts   |
| `get_llm_text`             | Markdown formatted for an LLM, for one event or the whole catalog     |
| `assess_impact`            | Who receives this event, where else the field travels, who to notify  |
| `check_change`             | What a proposed schema breaks, classified, and who it breaks          |
| `catalog_status`           | Catalog revision, working-tree freshness and review state             |
| `get_investigation_bundle` | Impact, compatibility and a handoff to autotel-mcp                    |
| `show_map`                 | The catalog, a flow or a design as a diagram in the conversation      |

In practice an agent asks things like "what fields does `payment.completed`
require?", "which events carry `customerId`?", or "which services consume
anything in the payments domain?" and gets generated state rather than a summary
of a summary.

## Diagrams in the conversation

`show_map` is an [MCP App](https://modelcontextprotocol.io/extensions/apps). In
Claude, ChatGPT and other hosts that run apps, it opens an interactive diagram
in the chat, which EventCatalog's MIT visualiser draws. A client without app
support gets the text answer. Pass a `focus` written the way `about:` names a
resource:

- `service/PaymentService`, `domain/payments`, `event/payments/payment.captured`
  draw the part of the catalog around it, with runtime evidence on each edge
  where a snapshot covers it.
- `flow/<id>` draws a flow under `flows/`, grouped as its frontmatter says.
- `design/<id>` draws a design under `designs/` at three levels, with what the
  catalog does not have yet drawn in outline.

Leave out `focus` to draw the whole catalog. To sketch architecture you have
not built, the agent passes `design` instead: the resources, relations and
notes a design file holds. The map marks which parts the catalog already has,
and the text result carries the frontmatter. Save it as `designs/<id>.md` and
open a pull request.

The map follows the host: its light or dark theme, the height it allows, and a
full screen button where the host offers one. Clicking a node tells the agent
which one the reader picked, without posting to the conversation, so "what
does this one do?" means that node.

The text result lists every edge with its evidence, so the agent can explain the
map it drew.

## The two that change what an agent does

The lookup tools answer _what is in the catalog_. `assess_impact` and
`check_change` answer the questions an agent has before it edits a contract.

`assess_impact` takes an event and optionally a field, and returns the consumers
that receive it, the other events carrying the same field path, the consumers
_those_ reach, and one deduplicated `notify` list. That second hop is the part a
human forgets. It also returns `provenance`, `confidence` and `needsReview`, so an
agent can tell a fact from a guess before it repeats one.

`check_change` takes a proposed JSON Schema and classifies it against the one the
catalog holds — `breaking`, `suspicious`, `additive`, `info` — with the consumers
each finding reaches. It runs the same classifier as the CI drift gate, so the
answer an agent gets before it writes the edit is the answer the pull request will
give it afterwards.

When the catalog carries runtime evidence, `assess_impact` also returns a
`runtime` block: how often the event was seen, which consumers the snapshot
records, and which declared consumers are absent from it. Consumer attribution
can be reported metadata rather than observed delivery. An absent consumer was
not recorded in this evidence; that is not proof it is gone.

The [`autocatalog-impact`](https://github.com/jagreehal/autocatalog/tree/main/skills/autocatalog-impact) skill
teaches an agent to ask both before editing, and what to refuse.

## Use autocatalog with autotel

Connect both MCP servers to give a coding agent contract context and runtime
investigation tools. Autocatalog reads the generated catalog; autotel queries
telemetry through its configured backend. Autocatalog does not hold backend
credentials or start another collector.

For a repository with both packages installed locally:

```json
{
  "mcpServers": {
    "autocatalog": {
      "command": "node",
      "args": [
        "/absolute/path/to/repo/node_modules/autocatalog-mcp/dist/index.js",
        "--root",
        "/absolute/path/to/repo"
      ]
    },
    "autotel": {
      "command": "node",
      "args": ["/absolute/path/to/repo/node_modules/autotel-mcp/bin/autotel-mcp"],
      "env": { "AUTOTEL_BACKEND": "collector" }
    }
  }
}
```

Replace the absolute paths with your checkout location. The collector backend accepts telemetry locally;
point the application's OTLP exporter at it. To read an existing backend,
configure autotel-mcp's backend and credentials instead. Signal support varies:
for example, the Jaeger backend supplies traces, while a composite stack can
query Tempo, Prometheus and Loki. Check `backend_health` and
`backend_capabilities`; an unsupported signal is not an empty result.

The companion `autocatalog-investigate` skill teaches this workflow:

```bash
npx skills add jagreehal/autocatalog --skill autocatalog-investigate
```

Ask the agent: **“Check this payment event change, identify affected consumers,
and verify the flow using runtime evidence.”**

Its first autocatalog call can be:

```json
{
  "ref": "payments/payment.completed",
  "field": "amountMinor",
  "schema": {
    "type": "object",
    "properties": { "amountMinor": { "type": "number" } },
    "required": ["amountMinor"]
  }
}
```

Pass this to `get_investigation_bundle`. The `schema` argument is the complete
proposed contract, not a patch. Omit it for investigation without a change.

The versioned `autocatalog-investigation/v1` response contains:

- A domain-qualified event identity and version, catalog root and freshness.
- Ownership, source, impact and optional compatibility findings.
- Snapshot generation time, observation range, counts, producer/channel sources
  and field types, when evidence is attached.
- Up to three distinct trace references and suggested autotel `summarize_trace`
  and `correlate` calls, preceded by health and capability checks.
- Service candidates for discovery when traces are missing or expired. These
  are catalog names requiring mapping, not assumed backend service identities.

The tool performs no network queries. The connected coding agent follows the
handoff using the tools actually available on autotel-mcp. It confirms backend,
environment and release before attributing telemetry to the event. The snapshot
format does not establish those identities, so the bundle marks them unknown.

### Attach evidence from a test run

Autotel's `ArchitectureSnapshotSubscriber` can write an architecture snapshot
after integration tests exercise a flow. Join that file during scanning:

```bash
ac scan --snapshot .autotel/snapshot.json
```

The snapshot contract accepts representative trace IDs, per-producer/channel
`sources`, `fieldPaths` and `fieldStats`. Only the field types are carried into
the catalog; primitive sample values are omitted. Published evidence is available
in `describe_event`, `assess_impact`, the investigation bundle and event pages.
An event name shared by multiple domains requires a `domain/id` snapshot key.

Consumer declarations are retained separately before enrichment adds snapshot
participants. Autotel snapshots normally supply reported consumer metadata;
this is labelled `reported`, not proof of delivery. Older manifests without an
attribution label read as `unknown`.

First/last seen describe observations, not continuous coverage. Counts may be
sampled. An absent consumer remains in the impact assessment, and no attached
evidence does not mean zero traffic. Trace-linked logs and service/time metrics
also provide different strengths of correlation.

To reproduce an investigation, retain the returned bundle with the selected
backend/environment/release, query window and telemetry references. The bundle
preserves catalog freshness and snapshot generation metadata; it cannot preserve
telemetry that the backend has already expired.

## The other half: plain markdown

Not every agent speaks MCP. The documentation site publishes a `.md` twin at
every page's URL plus `.md`, and an `llms.txt` index of the whole site, so an
agent that only fetches URLs still gets the source rather than scraped HTML. See
[the docs convention](/docs/docs-convention).
