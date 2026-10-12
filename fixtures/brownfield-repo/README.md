# Brownfield discovery fixture

This repository has a Mongoose writer, a trace-only reader, a Backstage service owner and an SQS command. The scanner never executes `statements.ts`.

From the workspace root:

```sh
pnpm ac:events resources scan fixtures/brownfield-repo --service billing --datastore main --database finance --traces fixtures/brownfield-repo/otlp.json
pnpm ac:events resources ownership fixtures/brownfield-repo --json
```

The scan writes `.autocatalog/resources.json` and saves the flags to `.autocatalog/config.json` in the fixture; delete `.autocatalog/` afterwards. The generated ownership row lists `billing` as writer and `reporting` as reader of `main/finance`'s `statements` collection. The service owner comes from Backstage; the collection itself has no explicit owner. The graph also includes the `generate-statement` command with one logical handler and a completion outcome.
