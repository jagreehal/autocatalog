---
'autocatalog-core': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
'autocatalog-cli': minor
---

The Catalog sidebar opens with Domains. Each domain lists its overview, subdomains, systems, services, events, commands, entities, flows, guides and runbooks, built from the catalog. A domain comes from an event, a service or a domain resource.

Write `overviews/domains/<id>.md`, `overviews/services/<name>.md` and `overviews/systems/<id>.md` to put your team's words at the top of each page. A domain's overview takes a `parent` to make it a subdomain. `ac docs check` catches two overviews of one resource and a parent cycle, and the site checks overviews of other repositories' resources.

Every service in the resource graph has a page, including command handlers and services declared in `.autocatalog/resources.json`. `/systems` lists the systems services belong to, and `ac docs check` reads `resources.json` as the site does.

The home page is a list of blocks, and `layouts.home` replaces it. Choose from `hero`, `cards`, `countCards`, `graph`, `docs`, `apis`, `attention`, `explore`, `tags` and blocks your extensions add. `ac site --print-layout home` prints your site's default to start from.

A site for an `audience` with one repository publishes its documents at the root. Set `"atRoot": false` to keep the repository's name. `ac site` warns when such a site has no `url`.

`order` in `docs/meta.json` places a repository in the Docs sidebar. `[[kind|id]]` links read as the last part of the id, and a flow step's `command: { ref: <domain>/<id> }` links the catalog command.

`examples/storefront` joins eight team repositories and a handbook into one site.
