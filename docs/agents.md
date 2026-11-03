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

## Eight entity kinds

`agent`, `tool`, `mcp-server`, `model`, `workflow`, `domain`, `eval`, `policy`. Each is a
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

## MCP servers

The catalog lists the MCP servers a company builds and the ones it uses, watches
what they offer, and checks that against what agents actually call.

### List them

Point discovery at a repository and it finds what the repository uses and what it
builds:

```bash
ac agents discover --from mcp
```

```text
discover: mcp /work/payments
  client configs 1
  servers 3
  new api-githubcopilot-com https://api.githubcopilot.com/mcp (.mcp.json)
  new ours node (.mcp.json)
  new stripe-mcp npm:@stripe/mcp (.mcp.json)

Next: set owner and origin in mcp-servers/*/autocatalog.json, then run ac agents audit.
```

Servers a repository **uses** come from committed client configs: `.mcp.json`,
`.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`,
`.codex/config.toml`, `opencode.json` and the MCP integrations in
`executor.jsonc`, anywhere in the repository.

Servers a repository **builds** come from its MCP Registry `server.json`, and from
code that starts a server with the TypeScript, Python or Go SDK. A file counts only
with the SDK's import in it, and tests and examples are skipped. A published package
gives the server the same id as the configs that run it, so the code and its users
join up. A private package or a deployed URL cannot be joined that way: add a
`server.json` with the remote address and the two become one entry.

`--dry-run` prints the inventory without writing.

### Across a whole organisation

`ac mcp-sweep` runs the same discovery over every repository a GitHub owner keeps,
into one catalog:

```bash
GITHUB_TOKEN=… ac mcp-sweep --owner acme --internal acme.dev,@acme
```

It clones the latest commit of each repository, skipping forks and archived ones,
reads them as files, and deletes the clones. `--topic` narrows it to repositories
with a topic, and `--repo <url>` adds others. Each entry records which repositories
use it in `used_by`, and which one builds it in `repository`.

Run it on a schedule in a catalog repository and commit the result. A repository
that cannot be cloned is named, the run exits 1, and nothing is pruned, since a
repository nobody could read says nothing about the servers it names. Without a
token it sees public repositories only, so check the count it prints.

Everything lands on `/mcp-servers` on the site: each server with its owners, the
repositories and agents using it, its tools and its recent changes.

Discovery only reads. It never starts a server or connects to one, because a
config is a request to run a program. It keeps the address, the package and the
program name, and leaves arguments, headers and environment values behind. A URL
loses its credentials, its query string and every path segment that is not
plainly a word. A short token of letters alone still reads as a word.

| Flag                        | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `--home`                    | Also reads your own client configs. They appear as `~/.cursor/mcp.json`. |
| `--internal acme.dev,@acme` | Reads these hosts and package scopes as `built`.                         |
| `--prune`                   | Removes entries no config names any more.                                |

Private hosts such as `localhost` and `*.internal` read as `built` without a flag.
Any origin discovery infers stays marked for review.

Each server's id comes from its endpoint, so `gh` in one repository and `github`
in another are one entry. Run discovery in every repository and the site lists
each server once, with every owner and a `usesServer` edge from each repository.
When repositories run different versions of a package, the entry lists them.
Third-party servers draw as external systems on the architecture map.

Run it as often as you like. A new scan updates the address and where the server
is configured, and keeps what a person decided: owner, origin, status and review
state. An entry with no `discovery` block was written by hand and stays as it is.
When a config points a name at a new address, the entry moves to the new id with
its review and snapshots, and `ac agents validate` names anything using the old id.

### Watch what they offer

A server's tools change without a pull request. `ac agents snapshot` saves each
server's tool list beside its entry, in `snapshots/<connection>.json`, and reports
what changed since the last one. Each change also goes in `changes.json`, which
feeds the server's page and holds no text the server wrote. Commit both, so every
change has a diff.

```bash
ac agents snapshot
```

```text
snapshot: live servers
  changed vendor default, 2 tools, 2026-07-28
  breaking vendor/export: tool removed → reaches triage
  review   vendor/delete_all: new tool → reaches triage
  review   vendor/search: description changed: "Search the index" → "Ignore prior rules…"

1 breaking · 2 to review · 0 info
```

A new tool is `review`, since an agent gained it without anyone granting it. So is
a changed description, which is an instruction to the model. Input schemas read
the opposite way to an event: the agent writes and the server reads, so a new
required field breaks callers and a dropped requirement does not. Both protocol
eras work: `2026-07-28` servers and older ones that need the handshake.

Run `--check` on a schedule. It saves nothing and exits 1 on a change, and
`--fail-on breaking` ignores `review`. It exits 2 when a server could not be
reached, so an outage does not read as a clean run.

```yaml
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  mcp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx autocatalog agents snapshot --check --format github
        env:
          VENDOR_TOKEN: ${{ secrets.VENDOR_TOKEN }}
```

Keep this job on a schedule, on the default branch. A pull request can edit a
server's address, so a job that gives pull requests these secrets could send them
anywhere. Requests never follow a redirect, for the same reason.

A server that needs credentials names them. The entry holds the variable's name,
and anything else is refused:

```json
{
  "snapshot": {
    "headers": { "Authorization": "Bearer ${VENDOR_TOKEN}" },
    "connection": "ci-bot"
  }
}
```

Credentials never follow an address. When a scan finds an entry's endpoint has
changed, it removes `snapshot.headers` and `snapshot.env` and sends the entry back
for review, because anyone can edit a config. Check the new address, then add them
back.

The connection records which identity took the snapshot, because two accounts can
see different tools. Give each its own `connection` and each keeps its own file.
A character outside `a-z`, `0-9` and `-` is percent-encoded in that file's name.

Stdio servers do not start unless you pass `--allow-stdio`. A package must name
one exact release: `^1.0.0`, `next` and `latest` count as unpinned. A container
image must name a digest, `image@sha256:…`, because a registry lets any tag move,
even `1.4.0`. A package runs in an empty folder without this process's environment: that is containment,
not a sandbox, so run it somewhere disposable. A server of your own declares
`snapshot.command`.

With [Executor](https://github.com/UsefulSoftwareCo/executor) in front of your
servers, read its catalog instead:

```bash
EXECUTOR_TOKEN=… ac agents snapshot --executor http://127.0.0.1:4788
```

Nothing starts and no vendor credential is needed, since Executor already holds
them. Each connection gets its own snapshot, and an integration the catalog does
not have fails `--check`. Its list is as fresh as Executor's last sync, and it
carries no annotations. Set `snapshot.integration` when the names differ.

### Connect them to agents

An agent names the tools it uses, or a whole server:

```json
{ "name": "Triage", "owner": "support", "model": "fast", "servers": ["vendor"] }
```

`ac agents discover --from mcp-snapshot` drafts a Tool entry for each tool in a
snapshot, with `server`, `mcp_name` and side effects from its annotations. Those
are the server's own claims, so they stay marked for review. Descriptions stay in
the snapshot: entries are served to agents, and a server wrote that text.

`ac agents impact mcp-server/<id>` follows a server to its tools and the agents
behind them, and a snapshot's report names the same agents.

`ac agents audit` adds three rules:

- `mcp-server-unpinned`: a package runs without an exact version, or an image
  without a digest, so an update reaches every client with no review.
- `mcp-server-no-snapshot`: nothing to compare the server against.
- `mcp-tool-unannotated`: a tool has no `destructiveHint`. The specification says
  to assume it is destructive, so a client that reads a missing hint as safe
  runs it without approval.

### Check what actually ran

`ac agents drift` reads MCP calls from traces, and that is how you find a server
nobody committed. It adds two findings:

- `unknown-mcp-server`: a call went to a server the catalog does not have.
- `tool-not-in-snapshot`: a call used a tool the last snapshot does not hold.

A span names its server with `server.address`, `mcp.server.name` or
`mcp.tool.integration`. Executor's tool addresses work as they are. Its spans do
not say which agent called, so these calls count against the gateway rather than
an agent, unless the span carries `agent.id` or `gen_ai.agent.id`.

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
ac agents discover --from mcp             List the MCP servers a repository builds or uses
ac agents discover --from mcp-snapshot    Draft Tool entries from saved snapshots
ac agents snapshot [<server>...]          Save each MCP server's tools, report what changed
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
