---
title: Runtime evidence with autotel
owner: Maintainers
summary: The contracts say what a service promises; a snapshot from its tests says what it sent.
tags:
  - autotel
  - ci
related:
  - docs/drift-ci
  - docs/site
  - docs/mcp
---

Autocatalog builds the catalog from source: what each service declares it
sends. [autotel](https://github.com/jagreehal/autotel) records what the service
sent while its tests ran. Autocatalog reads that record and puts the two side
by side on the site, in the drift gate and in the MCP tools.

## Record a snapshot

The service emits events with autotel's `track()`. The `_autotel` metadata is
optional; it names the producer, channel and consumers when the event name
alone does not:

```ts
import { track } from 'autotel';

track('order.placed', {
  ...order,
  _autotel: { producer: 'OrderService', channel: 'orders.events', consumers: ['BillingService'] },
});
```

The test suite attaches `ArchitectureSnapshotSubscriber` and writes the
snapshot when it finishes:

```ts
import { flush, init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

const snapshot = new ArchitectureSnapshotSubscriber({ service: 'orders-service' });

init({ service: 'orders-service', subscribers: [snapshot] });

after(async () => {
  await flush();
  await snapshot.writeToFile('.autotel/snapshot.json');
});
```

`.autotel/snapshot.json` lists each event that fired: how often, its field
paths and their types, who produced it on which channel, which consumers saw
it, and a few sample trace IDs. Commit it, and the tools below read it from the
repository.

## Where it shows up

| Surface                                                           | What it does with the snapshot                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`ac site`](/docs/site)                                           | Event pages show the count, first and last seen, sources per producer and channel, consumers declared vs observed, and trace IDs        |
| [Site maps](/docs/site)                                           | Edges that ran are solid and weighted by volume, declared ones never seen are dashed, undeclared ones are marked; Replay and Live modes |
| [`ac drift --snapshot`](/docs/drift-ci#runtime-drift)             | Fails CI on payloads the contract forbids, and on events, fields, producers or channels the code uses but the catalog does not declare  |
| [Flow pages](/docs/site)                                          | Show how the saga that carries out the flow ran: its runs, how each ended, and each step's failures and compensations                   |
| [`ac from-snapshot`](/docs/cli)                                   | Writes draft contracts from what ran, for a repository that has none yet                                                                |
| [`ac scan --snapshot`](/docs/mcp#attach-evidence-from-a-test-run) | Joins the evidence into the catalog the MCP server reads; `get_investigation_bundle` hands trace IDs to autotel-mcp                     |

Event names ignore case and `.`, `_`, `-`, so `track('order.placed')` is the
catalog's `OrderPlaced`. Field types reach the catalog and sample values stay
out of it. Drift reads them in memory to check enums and integers, and its
report counts the values it rejects without printing them. A consumer
the snapshot saw but the catalog never declared shows as observed, and a
declared consumer it never saw shows as never observed. Treat both as leads: a
test run covers what your tests exercise.

With `--base-ref`, `ac drift` also reads the snapshot the base committed, so
it reports a gap the default branch already has without failing your pull
request ([only what the change introduced](/docs/drift-ci#only-what-the-change-introduced)).

## Delivery outcomes

A dead-letter queue on its own is storage. To see why a message landed there,
the consumer records each outcome on its span with autotel's `traceConsumer`
context: `ctx.recordRetry(attempt, max)` before a retry, `ctx.recordDLQ(reason,
queue, { reasonCategory, attemptCount })` when it gives up, and
`ctx.recordReplay()` when a replayed message comes back. With the snapshot's
`spanProcessor` registered, each consumer it saw receiving an event carries
what happened to those deliveries:

```json
{
  "consumer": "PaymentService",
  "channel": "orders.events",
  "count": 6,
  "failed": 4,
  "retried": 2,
  "deadLettered": 1,
  "replayed": 1,
  "deadLetterReasons": [
    {
      "reason": "payment provider unavailable",
      "category": "transient",
      "queue": "orders-dlq",
      "count": 1
    }
  ]
}
```

`ac scan --snapshot` keeps the consumers with a failure, retry, dead letter or
replay. The event page says what happened beside each consumer, `6 deliveries:
4 failed, 2 retried, 1 dead-lettered, 1 replayed.`, lists why deliveries were
dead-lettered, and names the queue a consumer [declares](/docs/drift-ci#consumers-in-other-repositories)
for them. `get_investigation_bundle` hands the same outcomes to an agent, with
the trace IDs to follow.

## Workflow runs

A saga run with autotel's `traceWorkflow` and `traceStep` records each run and
each step on its spans, and the snapshot's `spanProcessor` turns them into
`workflows`:

```json
"FulfilOrder": {
  "name": "FulfilOrder",
  "runs": 4,
  "completed": 3,
  "compensated": 1,
  "steps": [
    { "name": "ReserveStock", "count": 4, "compensated": 1 },
    { "name": "ShipOrder", "count": 4, "failed": 1 }
  ],
  "sampleTraceIds": ["00f067aa0ba902b7a3ce929d0e0e4736"]
}
```

The [flow](/docs/site) the saga carries out shows its runs, and each step's
runs beside the step of the same id or title. A step that failed to
compensate is the one to look at first: the saga left something undone.

## Live and replay

The site's maps start static, with the snapshot's evidence drawn on each edge.
Replay sends markers across the edges that ran, more often where the snapshot
saw more, and needs no server. Live moves an edge each time a server-sent
events frame names its event: run `ac site --live-url <url>`
([the company site](/docs/site)). The site only listens. With reduced motion,
an edge brightens in place.

Look up the trace IDs on an event page in your tracing backend.

[Experiment 05](https://github.com/jagreehal/autocatalog/tree/main/experiments)
runs the whole loop: tests write the snapshot, `ac drift` gates on it, and the
site and EventCatalog both show it.
