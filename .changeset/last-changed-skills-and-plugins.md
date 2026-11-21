---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-agents-core': minor
'autocatalog-agents-cli': minor
'autocatalog-cli': minor
---

Event, API, specification, entity, data product and data model pages end with the day their file last changed, as documents do. An event discovered from code takes the date of the file it came from. Git dates every page; with no repository, an uncommitted file or a shallow clone, the page shows no date.

The home page lists what changed most recently, documents and resources together, under the architecture map. Name the `recent` block in `layouts.home` to place it. A site for an `audience` does not publish it.

`ac agents discover --from skills` lists the agent skills and Claude Code plugins a repository commits: every `SKILL.md`, slash command and Cursor rule with its `allowed-tools`, each plugin with the skills, subagents, commands, hook events and MCP servers it ships, each marketplace, and the plugins `.claude/settings.json` turns on. They become `skill` and `agent-plugin` entries in `agent-skills/` and `agent-plugins/`, with an owner, and join the graph: a repository defines and uses plugins, and a plugin defines its skills. `.claude/settings.local.json` and your home folder are never read.

`--check` exits 1 when the files no longer match the committed entries, and marks a new allowed tool, hook or MCP server for review.

`/skills` on the site lists every plugin and skill, and `ac mcp-sweep` reads them across a GitHub owner too. Two repositories can each keep a skill or a plugin of one name. Paths a plugin manifest names are read only when they resolve inside the repository, links included.

MCP discovery also reads the servers a plugin declares in `.claude-plugin/plugin.json`.

The check action is the company gate. `consumers` names the consumers other repositories declare, `require-consumers` fails when the company site cannot be read, and `max-consumers-age` fails on a stale one; `ac check` and `ac drift` take the same as `--consumers`, `--require-consumers` and `--max-consumers-age`. The action keeps one pull request comment with the result, through `ac check --comment`, editing only a comment a bot wrote, and runs the autocatalog release it ships with instead of the newest. With `--allow-code-execution`, `ac check` runs installed plugins such as Zod, and drift compares the events they read from source; without it, the contracts and drift steps name the plugins they skipped and check the rest.

`ac site --strict` publishes nothing when a repository or source is left out, and the site action builds with it by default. Every build writes `/catalog.meta.json`: when it was built, the lock's digest, its size and what it left out.

`ac federation status --fail-on gateway,network` fails on those findings too, as it can on `unresolved`, `unpinned` and `behind`.
