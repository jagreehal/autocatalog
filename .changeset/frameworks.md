---
'autocatalog-core': minor
'autocatalog-cli': minor
'autocatalog-docs-core': minor
'autocatalog-docs-astro': minor
---

- Federation. `ac site` composes autocatalog repositories and EventCatalog projects into one company site, and leaves their checkouts untouched. `ac federation lock` pins each enrolled repository to a commit in `autocatalog.lock.json`, and `ac site` builds those commits, checking each tree. The token goes only to GitHub over HTTPS. `ac federation status` lists each source's pin and resources, references that don't resolve, and ids two repositories define. `--index` joins another site's `/catalog.json` into the graph.
- `autocatalog.consumes.json` takes `receives` and `sends`: events and commands another repository owns, by id or `domain/id`, with an exact version, `latest` or a range such as `^1`. A range picks from the publisher's git history too.
- `ac delivery` traces each event to its consumers through the broker's own configuration: RabbitMQ `definitions.json`, CloudFormation for SNS, SQS, EventBridge and IAM, Strimzi for Kafka, and ARM for Azure Service Bus. It names the rule and line behind each hop, flags routes, filters, dead-letter queues, retention, retries and identities, and marks each finding confirmed, policy, possible or unknown. Event pages draw the path.
- `ac delivery verify --disposable` delivers each committed example to a test RabbitMQ and checks the declared routes, recovery and attempt limits.
- `ac drift --consumers` checks a change against the broker configuration, events and consumers that other repositories publish, and names each consumer the change breaks. Findings show every queue, rule and service name as code.
- `ac site` leaves out the documents of a repository whose frontmatter breaks the contract, names the file, and builds the rest. Each `ac site` run builds in a folder of its own.
- `ac site <repo>` builds a repository that publishes only `contracts/` or `autocatalog.consumes.json`. Scans skip `target/`, `bin/` and `obj/`.
- New guide and examples: events and APIs from Rust, Go, Java and .NET, and a federation of team repositories checked by `pnpm verify:federation`.
