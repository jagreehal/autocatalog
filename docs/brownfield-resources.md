---
title: Brownfield resources
owner: Maintainers
summary: Discover datastore access, commands and services, then import ownership and registry contracts.
tags:
  - guide
---

# Brownfield resources

Autocatalog can build a graph before a repository has event declarations. Collections, tables, commands, queues and services share the catalog with events. Database access edges answer “who writes statements?”; their evidence records operation counts, timestamps and sample trace IDs.

## Start with code or traces

```sh
ac resources scan ./repo --service billing --datastore main --database finance
ac resources scan ./repo --traces ./week-of-otlp.json --datastore main --environment production
ac resources ownership ./repo --json
```

The trace input is an OTLP JSON export with `resourceSpans`, `scopeSpans` and `spans`. Database semantic conventions, including older MongoDB attributes, identify collections or tables and operations. Parent span relationships identify cross-service calls; messaging attributes identify queue producers and consumers. A queue alone does not establish whether its messages are events or commands.

The graph is saved in `.autocatalog/resources.json`; commit it, because the site publishes it and later scans keep its promotions and imported evidence. Normal `ac scan` also runs resource discovery: when it finds resources it writes that file and a copy at `<out>/resources.json` inside the catalog artifact, and says so. A repository with no resources gets no `.autocatalog/` directory, and once a repository has no resources left, the scan removes the graph it wrote earlier and says to commit the deletion. Repositories containing only that graph appear in the site's `/catalog` and `/catalog.json`; the catalog includes a datastore ownership table and evidence details.

`--service`, `--datastore`, `--database` and `--environment` given to `ac resources scan` or `ac scan` are saved to `.autocatalog/config.json`, and the command says so. Every later rescan — a plain `ac scan`, or the rescan after `ac resources import` — reads them from there, so the same resources keep the same identities. Commit the file. You can also write it yourself:

```json
{
  "service": "billing",
  "datastore": "main",
  "database": "finance",
  "environment": "production",
  "ownership": {
    "precedence": ["backstage", "datadog", "codeowners"],
    "teamAliases": { "group:default/ledger": "ledger" }
  }
}
```

Use a stable logical datastore name in both code and trace scans. Its database name completes the resource namespace, for example `main/finance`. Without configuration the namespace is `default/default`, never the directory name, so a baseline checkout and the current tree compare the same resources. Code access edges are attributed to `--service`, else the `name` in the root `package.json`, else `default`. A command's namespace is its manifest's `domain`, else `default`. When two files define the same resource differently, the scan keeps the resource without a schema, marks it for review and reports a skipped entry naming both files, rather than failing. Keep evidence from environments you want to review independently in separate repository roots. Missing operations or ambiguous database operations cannot establish a read/write edge. Counts describe supplied spans, not total production traffic.

Observed edges remain reviewable. List the keys, then promote a reviewed relationship by the key it prints:

```sh
ac resources list ./repo
ac resources promote ./repo --relationship 'service:reporting--reads-->collection:main/finance/statements'
```

`ac resources list` prints keys readably; `--json` gives the exact, URL-encoded keys stored in the graph (`collection:main%2Ffinance/statements`). `promote --relationship` and `validate --resource` accept either form.

Promotion preserves evidence and survives subsequent scans. Source-only rescans retain saved observations. Re-importing the same OTLP export counts its spans once; different exports that contain the same spans both count, so avoid overlapping exports when interpreting counts. The site applies the same rule when two repositories import the same export.

## Model contracts and document validation

Static adapters discover Mongoose schemas, Prisma models and Drizzle tables without executing repository code. They extract collection/table JSON Schema and recognizable read/write operations, including relative imports and Prisma field mappings. Dynamic models and unsupported constructs produce scan diagnostics. Review extracted contracts before using them as authoritative compatibility gates.

For Mongoose models that are built dynamically, export the actual models' schemas in application-controlled code with the core API:

```ts
import { exportMongooseModels } from 'autocatalog-core';
import fs from 'node:fs/promises';

const contracts = exportMongooseModels([Statement], { datastore: 'main', database: 'finance' });
await fs.writeFile('.autocatalog/models.json', JSON.stringify(contracts, null, 2));
```

This uses each model's `schema.toJSONSchema()`; run it in an environment with a Mongoose version exposing that method. Explicit model exports take precedence over passive extraction. Inspect the exported array's collection identity and align the scan's datastore/database options with trace discovery.

Compare saved graphs, or use the normal drift command alongside event drift:

```sh
ac resources drift ./repo --base ./baseline --fail-on breaking
ac scan ./baseline --out /tmp/baseline-events
ac scan ./repo --out /tmp/current-events
ac drift --base /tmp/baseline-events --current /tmp/current-events
```

`ac drift` in directory mode reads the `resources.json` each artifact carries, so datastore and command changes gate with event changes, `--compatibility` included. When only one artifact has a graph, it warns and compares no resources — against a missing graph every resource would read as removed. `--base-ref` scans both trees itself.

Schema changes report affected readers. Unknown field usage remains conservative. Versioned registry contracts select the latest numeric version rather than lexicographic order. A major version bump acknowledges a breaking change to a versioned resource, as for events: still reported, with who to tell, but not a failure. New observed writers are suspicious, so they fail only `--fail-on suspicious`.

To check runtime document evidence, supply a JSON array:

```json
[
  {
    "resource": { "kind": "collection", "namespace": "main/finance", "id": "statements" },
    "kind": "document",
    "value": { "amount": 42 }
  }
]
```

```sh
ac resources validate ./repo --observations ./documents.json
```

Only complete `document` observations are validated. `projection` and `patch` observations are skipped. Ordinary database spans establish access, not document validity. Validation reports schema paths and keywords without echoing document values.

## Commands and outcomes

Declare a command in `commands/generate-statement/autocatalog.json`, with a payload `schema.json` beside it:

```json
{
  "kind": "command",
  "id": "generate-statement",
  "version": "1.0.0",
  "name": "Generate statement",
  "summary": "Generate a customer's monthly statement",
  "senders": ["billing"],
  "handler": "statement-worker",
  "schema": "./schema.json",
  "outcome": { "type": "completion" },
  "transport": [{ "address": "statement-jobs", "protocols": ["sqs"] }]
}
```

Alternatively, embed that declaration under `x-autocatalog` in a `schema.json` file. A command has exactly one logical handler, even when that handler has multiple worker instances. Missing or competing handlers are breaking findings. An outcome may be `completion`, `result` with a schema file, or `event` with an event identity. Outcome/result changes affect senders; input schema changes affect handlers. Declared commands are separate from event discovery.

## Import existing ownership

Local `catalog-info.yaml` files are discovered during scanning. Remote imports are saved under `.autocatalog/imports/` and applied to subsequent scans:

```sh
ac resources import backstage ./repo/catalog-info.yaml --root ./repo --id catalog
BACKSTAGE_TOKEN=... ac resources import backstage --url https://backstage.example --root ./repo --id catalog
DD_API_KEY=... DD_APP_KEY=... ac resources import datadog --root ./repo --id catalog
```

Backstage Components with `spec.type: service` become services. Processed `ownedBy` relations take precedence over raw `spec.owner`. Use the `autocatalog.io/service` annotation when the catalog name differs from `service.name`. Datadog imports its v2.2 Service Definition API; supply `--url` for another Datadog site. CODEOWNERS supplies repository ownership where richer sources are absent. Explicit resource owners win over imports, and source conflicts are reported rather than silently discarded. Credentials are read from environment variables and are not saved in graph imports. An import's rescan uses the identities saved in `.autocatalog/config.json`.

## Several repositories on one site

The site composes every enrolled repository's `.autocatalog/resources.json`. A repository may add its own resources and relationships, and runtime evidence to any resource. It may not redefine or take ownership of a resource another repository already declares, including its events: that repository's resource graph is quarantined, and the build and `/catalog` name the repository, the resource and who declares it, as for contradicting events. Repositories are composed in name order, so the first declaration stands. A `resources.json` that cannot be read or does not match the graph contract is quarantined the same way, naming the file; the rest of the site builds.

## Registries and CloudEvents

```sh
CONFLUENT_AUTHORIZATION='Basic ...' ac resources import confluent --url https://registry.example --root ./repo --id kafka
ac resources import glue --registry production --region eu-west-1 --root ./repo --id glue
```

Glue uses the standard AWS SDK credential chain. Importers retain native JSON Schema, Avro or Protobuf definitions, registry identity, versions, compatibility policy and referenced schemas. JSON Schema projections support catalog/drift workflows; native contracts remain available because projection cannot express every registry rule. Registry subjects are imported as reviewable event contracts; review their logical identities and ownership. These commands read registries and do not register schemas or change compatibility settings. A Confluent subject whose schema does not translate is skipped and named; the rest import.

An event can declare `envelope: { "type": "cloudevents", "mode": "structured", "specversion": "1.0" }`. Its JSON Schema describes the payload under `data`, and structured examples include the full envelope. Binary payload examples continue to describe the body; validate their HTTP context separately with a header file:

```sh
ac resources validate ./repo --cloud-event ./event.json --resource '<resource key>'
ac resources validate ./repo --cloud-event ./body.json --headers ./headers.json --resource '<resource key>'
```

`--resource` takes a key from `ac resources list`; `--resource` and `--headers` are refused without `--cloud-event`. The contract's declared envelope mode decides how the message is read. Header files are string-valued JSON objects containing `ce-specversion`, `ce-id`, `ce-source`, `ce-type` and optional context headers. Envelope failures and payload failures are reported separately. CloudEvents does not replace the underlying payload contract.
