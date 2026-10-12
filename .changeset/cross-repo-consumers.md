---
'autocatalog-core': minor
'autocatalog-cli': minor
'autocatalog-docs-astro': minor
'autocatalog-adapter-zod': minor
---

Teams can declare the events they consume from their own repository, so a producer's pull request names consumers in every repository.

- `autocatalog.consumes.json` lists a service, another team's event as `domain/id`, and the fields it reads.
- `ac site` publishes every repository's declarations in `/catalog.json` and lists them on each event's page.
- `ac drift --consumers <url|file>` reads that index and names the consumers each change reaches, by the fields they read. It prints when the index was published, and counts the consumers of every copy of an event two repositories publish unless `--repository` names its own.
- `ac validate --catalog <url|file>` checks each declared field against the schema the producer publishes.
- `ac drift --snapshot` names the consumers a runtime snapshot recorded.

The Zod adapter's name-encoded export shape is now the compact shape: `parseCompactName`, `CompactItem` and `isCompactItem`.
