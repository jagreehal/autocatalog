---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-mcp': minor
'autocatalog-cli': minor
---

- `designs/<id>.md` proposes architecture you have not built yet, in the
  vocabulary of EventCatalog Studio's model. Each design gets a page that marks
  what the catalog has and what is new, with three levels of detail.
  `ac docs check` checks designs as it checks flows.
- `show_map` draws the catalog, a flow or a design as an interactive diagram in
  Claude, ChatGPT and other MCP App hosts, with runtime evidence on each edge.
  It follows the host's theme and size, opens full screen on request, and tells
  the agent which node you picked. An agent can sketch a design in the chat and
  hand you the file to commit.
- A flow's `lanes:` sets how its map opens, and a step's `lane:` sets which lane
  it sits in. Flows can also group by system.
