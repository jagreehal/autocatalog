---
'autocatalog-cli': patch
'autocatalog-docs-astro': patch
---

`autocatalog site` builds inside any project layout. It renders with its own React when the project installs another React at the top of a flat `node_modules`, such as an EventCatalog project, and it brings the js-yaml its bundled Starlight code imports.
