---
'autocatalog-core': minor
'autocatalog-plugin-zod': patch
---

`autocatalog-core/plugin` is the part of core a plugin builds on: the scanner types, the JSON helpers, and the writers for events, components, gateways, networks and models. A plugin that imports only from it keeps working when the rest of core changes. `autocatalog-plugin-zod` imports from it.

The Kong, Kubernetes, Storybook and ODCS plugins now release from [autocatalog-plugins](https://github.com/jagreehal/autocatalog-plugins).
