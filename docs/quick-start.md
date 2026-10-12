---
title: Quick start
owner: Maintainers
summary: One command from a repository with contracts/ and docs/ to a site.
tags:
  - overview
related:
  - docs/introduction
  - docs/events/zod
---

Put event contracts in `contracts/` (JSON Schema, OpenAPI, Avro or protobuf) and
markdown in `docs/`. Then, from the repository root:

```bash
npx autocatalog site . --dev
```

That serves the site with live reload and writes nothing into your repository.
Drop `--dev` to build it instead: it goes to `dist/`, which is build output, so
add `dist/` to `.gitignore` rather than committing it.

Each event gets a page with its schema, examples, and the services that produce
and consume it. Those services get pages too, and `/fields` indexes every field
across every event. You never write a service definition: the pages come from
each event's `producers` and `consumers`. A document whose frontmatter says
`about: [event/orders/order.placed]` is listed on that event's page.

If an event is missing, see what each format needs:
[JSON Schema](/docs/events/json-schema), [OpenAPI](/docs/events/openapi), or
[Avro / protobuf](/docs/events/avro-protobuf).

## Contracts somewhere else: commit a catalog

`ac site` scans only `contracts/`, and never runs your code. If your contracts
live elsewhere in the repository, or are Zod models, scan them and commit the
result:

```bash
npx autocatalog .                          # JSON Schema, OpenAPI, Avro, protobuf anywhere
npx autocatalog . --allow-code-execution   # also Zod; this runs your code
git add events && git commit -m "catalog"
```

The scan writes `events/` (one folder per event, plus `events/llms.txt`) and
says so. Commit it: once `events/` exists, `ac site`, the company site and the
MCP server read it in place of scanning `contracts/`. If you do not commit it,
delete it, or it goes stale and the site keeps showing the old scan. Re-run the
scan whenever a contract changes; the folder is generated, so nobody edits it by
hand. Pydantic models are extracted into `events/` by `autocatalog-py` instead:
see [Zod](/docs/events/zod) and [Pydantic](/docs/events/pydantic).

## Gate pull requests on drift

A contract nobody checks breaks a consumer eventually. One command in CI fails
the pull request that does it, naming the consumers it breaks:

```bash
git fetch origin main
npx autocatalog drift --base-ref origin/main --root .
```

It scans both git states itself, so it needs no committed catalog. See
[drift gating in CI](/docs/drift-ci).

## Then the company site

To build one site across every repository your company enrols, see
[the company site](/docs/site). Other paths in:

| Your contracts live in                  | Read                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| TypeScript, with Zod                    | [Zod](/docs/events/zod)                                                         |
| Python, with Pydantic                   | [Pydantic](/docs/events/pydantic)                                               |
| `.json` schema files in a repo          | [JSON Schema](/docs/events/json-schema)                                         |
| OpenAPI, Avro, or protobuf in a repo    | [OpenAPI](/docs/events/openapi) · [Avro / protobuf](/docs/events/avro-protobuf) |
| Another repo, AsyncAPI, or EventCatalog | [Importing](/docs/events/importing)                                             |
