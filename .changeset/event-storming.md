---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
'autocatalog-mcp': minor
'autocatalog-chatbot': patch
---

Flows draw as EventStorming boards: stages, actors, commands, policies, read models, tracks and Given, When, Then scenarios, with a hotspot for each failure that has no policy. `ac flows draft` drafts a flow from an Effect v4 program, and `<Storm>` and `<Sticky>` work in MDX.

`/services/` lists every service with its owner, APIs, events and calls, from events, OpenAPI specs or both. CODEOWNERS sets the owner of services, endpoints, gateways and repositories.

Each API's Scalar reference opens in a frame beside the site's navigation, in its theme, with the reader's place in the address. The sidebar link reads "Scalar" unless you set `apiReferenceLabel`.

A rail holds the site's sections, from `nav` with an optional `icon`, and the sidebar shows the current section under its name. Page changes fade, and a change of section slides the sidebar. The sidebar draws repositories as headings, folders with folder icons and pages with their kind's icon.

Sites use grey neutrals, Inter for text and JetBrains Mono for code. The home page opens with count cards, chosen by `homeCounts`, and the architecture map. Maps size to their graph, a flow's walkthrough starts from a button above its map, filters keep text typed while the page loads, and asking a person for help works before the assistant has loaded.

On Sätteri, Astro's default Markdown processor, Mermaid diagrams, `[[kind|id]]` links, a document's repeated title and scrollable tables work as they do on unified.
