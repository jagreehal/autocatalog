---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-mcp': patch
'autocatalog-agents-mcp': patch
---

- Edit a design on EventCatalog Studio's canvas under `ac site` dev. The panel beside it shows what the design adds, who owns each catalog resource it touches, and what a runtime snapshot saw on each relation. New parts carry a dashed outline. ⌘S writes `designs/<id>.md`, one line per resource and relation, ready to commit.
- Start a design from `/designs`. When an agent, an editor or another tab writes the file, the open canvas loads it in place and asks first if you have unsaved changes.
- Designs take `hotspots:`, listed first on the design page.
- Click a node on a map to see its card, with a button to its page.
- The Versions card on an event shows each version's changes as a timeline.
- MCP tools return compact JSON.
