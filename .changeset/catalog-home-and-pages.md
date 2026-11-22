---
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
---

The home page opens with a search field, then where the catalog's facts come from: how many resources and relationships it extracted from code, how many their owners declared and how many it inferred, beside what needs attention. Browse by type, the architecture map and the five latest changes follow. A site arranges them with three new `layouts.home` blocks: `search`, `provenance` and `browse`.

The architecture map opens on the domains at a size you can read, each edge counting the messages that cross it. L2 shows services and data, and L3 shows every message.

Event pages open with Impact: the producers, consumers, owner and flows, each a link. Event, service and domain pages carry breadcrumbs.

The knowledge graph and Services pages are sortable tables of 25 rows a page. A link keeps its search and sort, and a link to one resource opens the page it sits on.

Each resource kind has its own colour on its icon: events orange, commands blue, services pink, and the rest as the map draws them.
