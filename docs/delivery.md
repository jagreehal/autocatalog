---
title: Delivery
owner: Maintainers
summary: How an event reaches each consumer, read from the broker configuration, checked in pull requests and proven against a test broker.
tags:
  - guide
  - ci
related:
  - docs/drift-ci
  - docs/brownfield-resources
  - docs/cross-domain-delivery
---

# Delivery

A contract check proves the payload still fits. It doesn't prove the message
still arrives. A subscription filter that stops matching, a dead-letter queue
that points nowhere, a retention period shorter than a consumer's outage or a
permission someone removed all leave the schema untouched.

autocatalog reads the broker's own configuration and routes each committed
example through it.

## What it reads

| Broker                       | Configuration                                 | What it learns                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RabbitMQ                     | `definitions.json` or `*.definitions.json`    | exchanges, queues, bindings and their arguments, policies, dead-letter and alternate exchanges, TTL, idle expiry, length limits, quorum delivery limits, users, permissions and topic permissions                                                       |
| AWS SNS, SQS and EventBridge | CloudFormation or SAM templates, JSON or YAML | topics and subscriptions with their filter policies, queues with retention, visibility timeout and redrive, buses and rules with their patterns, targets' retry policies and dead-letter queues, queue policies, and IAM roles that publish and consume |
| Kafka                        | Strimzi `KafkaTopic` and `KafkaUser`          | topics with retention, and who may write, read and join which consumer groups                                                                                                                                                                           |
| Azure Service Bus            | ARM templates (what Bicep compiles to)        | topics, subscriptions with their SQL and correlation rules, queues, delivery counts, lock durations, time to live, built-in dead-letter queues, and shared access rules                                                                                 |

The event and its consumers say the rest:

| From                           | What it says                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The event's `transport`        | where it is published, its routing key, the payload fields copied into headers, who publishes it (`identity`), and EventBridge's `source` and `detailType`                                                                                                                       |
| The event's committed examples | the messages routed: JSON Schema `examples`, or `example` under `x-autocatalog`                                                                                                                                                                                                  |
| `autocatalog.consumes.json`    | for each consumer: the queue, subscription or topic it reads, its consumer `group`, who it consumes as (`identity`), how long it may be down (`recovery`), how long a message may take, retries included (`processingWindow`), and the dead-letter queue and attempts it expects |

```json
"x-autocatalog": {
  "id": "payment.completed",
  "version": "1.0.0",
  "domain": "payments",
  "producers": ["PaymentService"],
  "transport": [
    {
      "address": "payments",
      "protocols": ["amqp"],
      "routingKey": "payment.completed",
      "headers": ["currency"],
      "identity": "payment-service"
    }
  ]
}
```

```json
{
  "consumes": [
    {
      "service": "LedgerService",
      "event": "payments/payment.completed",
      "queue": "ledger.payments",
      "identity": "ledger-service",
      "recovery": "PT12H",
      "processingWindow": "PT10M",
      "deadLetter": { "queue": "ledger.dead-letter", "maxAttempts": 5 }
    }
  ]
}
```

`protocols` says which broker to look in: `amqp` (RabbitMQ or Service Bus),
`rabbitmq`, `kafka`, `sns`, `sqs`, `eventbridge` or `servicebus`. For Kafka,
`queue` defaults to the topic and `group` is the consumer group. For Service Bus,
a subscription is `topic/subscription` and its dead-letter queue is
`topic/subscription/$deadletterqueue`. An event on the default EventBridge bus
leaves `address` empty.

`ac resources scan` and `ac scan` add what they read to
`.autocatalog/resources.json`. Exchanges, topics, buses, rules, queues and
subscriptions become `queue` resources, joined by `routesTo` and
`deadLettersTo` relationships. Each carries the file and line that declares
it, and the environment from `.autocatalog/config.json`.

## See the path

```bash
ac delivery .
```

```text
payments/payment.completed (staging) → LedgerService
  PaymentService
    → payments exchange
      → ledger.payments queue [currency = GBP]  infrastructure/rabbitmq/definitions.json:41
        → LedgerService
        → rejected: ledger.dead-letter → ledger.dead-letter
  keeps messages until they are read · redelivers a failed message without limit
  example example-1 (currency = GBP): reaches
  example example-2 (currency = EUR): excluded

possible   the routes to ledger.payments exclude the committed example example-2 (currency = EUR), so LedgerService would not receive it
```

The event's page on the site draws the same path.

## What it checks

| Area               | Example finding                                                                                                                                             | Confidence                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Routes             | "LedgerService declares that it consumes payment.completed from ledger.payments, but nothing routes payments to it"                                         | confirmed                                                                                                              |
| Filters            | "the routes to ledger.payments exclude the committed example example-2 (currency = EUR)"                                                                    | possible                                                                                                               |
| Delivery access    | "no access policy read here lets payments deliver to ledger-payments" (an SQS queue without a queue policy for its topic or rule)                           | possible, or confirmed when a policy names other sources                                                               |
| Consumer groups    | "AuditService and LedgerService all join consumer group ledger on payments, so each receives only some of the messages"                                     | confirmed                                                                                                              |
| Dead-letter queues | "ledger.payments dead-letters to ledger.gone, which the broker configuration does not declare"                                                              | confirmed                                                                                                              |
| Retention          | "ledger-payments keeps unread messages for 1 hour, shorter than the 12 hours LedgerService declares it may be down"                                         | policy                                                                                                                 |
| Retries            | "a failing message on ledger-payments can be retried for up to 20 minutes (20 attempts, 1 minute apart), longer than the 10 minutes LedgerService declares" | policy                                                                                                                 |
| Permissions        | "PaymentService publishes as payment-service, which cannot publish to exchange payments"                                                                    | confirmed for RabbitMQ and Kafka, possible for IAM and Service Bus, whose access can be granted outside the files read |

Confidence means:

| Confidence | Meaning                                          |
| ---------- | ------------------------------------------------ |
| confirmed  | the configuration is wrong on its own terms      |
| policy     | it misses something a consumer declared it needs |
| possible   | it may matter, and the catalog can't say         |
| unknown    | part of the route was not evaluated              |

A requirement is checked only when the consumer declares it. Without a
`recovery`, retention isn't compared. Without `deadLetter`, a missing
dead-letter queue isn't a finding. An unknown anywhere means the result is
incomplete, and `ac delivery` says so rather than reporting that every route
works. Unknowns include an exchange type other than direct, fanout, topic or
headers, an SNS or EventBridge operator such as `cidr`, a Service Bus `LIKE`,
Kafka retention left to the cluster default, or a consumer without a group.
`ac delivery` exits 1 on confirmed and policy findings.

AWS policies are evaluated as IAM evaluates them: an explicit Deny wins over any
Allow. A condition other than `aws:SourceArn` under `ArnEquals`, `ArnLike`,
`StringEquals` or `StringLike`, or a `NotPrincipal`, `NotAction` or
`NotResource`, leaves delivery unknown rather than granted. A statement counts
only when its `Resource` names the queue (or `*`); one it cannot resolve, such as
a `Fn::Sub` ARN, is unknown too. In queue and identity policies alike, a Deny that may apply leaves a grant
undecided, and an Allow that may apply is undecided only when nothing else grants:
it never cancels an unconditional Allow. For RabbitMQ, a
queue's own argument overrides an ordinary policy, and an operator policy caps
both. In Service Bus SQL, a missing property is unknown, so neither `IN` nor
`NOT IN` matches it.

RabbitMQ policies and permissions match names by regular expression.
autocatalog runs a pattern only when it can't backtrack badly: letters, digits,
anchors, escapes, alternation and up to two `.*`, with no quantified group, in
at most 255 characters. Anything else is unknown, because a pattern in an
untrusted pull request must not stall the scan.

Every queue, rule, service and example a finding names is shown as code,
whether it comes from this repository or the company's `catalog.json`. A name
reads as written, and can't become a link, mention or tag in the pull request
comment.

## In a pull request

`ac drift` compares delivery on both sides. A committed example that reached a
consumer and no longer would is breaking:

```text
breaking   payments/payment.completed: delivery to ledger.payments in staging changed: previously currency = GBP, proposed currency = EUR. The committed example example-1 (currency = GBP) would no longer reach LedgerService → breaks LedgerService. Restore the route, or agree the change with LedgerService's owner first
```

Comparing two saved artifacts works the same way: `ac scan --out` copies the
repository's `autocatalog.consumes.json` into the artifact beside
`resources.json`, and `ac drift --base <dir> --current <dir>` reads each
artifact's own copy.

A confirmed or policy problem the change introduces is breaking, such as a
retry policy that now exceeds a consumer's processing window. A possible one is
suspicious. So is a committed example that reached a consumer before the
change and can no longer be evaluated. Anything else the change leaves
unevaluated is reported as info, and drift warns that delivery was not fully
evaluated.

RabbitMQ reads patterns as PCRE. autocatalog evaluates only the escapes PCRE
and JavaScript read the same way (`\.`, `\d`, `\w`, `\s` and escaped
punctuation); a pattern with any other escape, such as `\A`, is unknown.

## Routes split across repositories

In most companies the broker configuration, the event and each consumer live in
different repositories. The site composes them: an infrastructure repository's
`.autocatalog/resources.json`, the payments repository's events and the ledger
repository's `autocatalog.consumes.json` make one route, drawn on the event's
page.

In a pull request, pass the company site's index:

```bash
ac drift --base-ref origin/main --root . --consumers https://catalog.acme.dev/catalog.json
```

The repository's own broker configuration, events and consumers replace what
the index has for them, on both sides of the change, and everything else comes
from the index. A binding change in the infrastructure repository then names
LedgerService, though neither the event nor the consumer is declared there.

## Against a running broker

The configuration in the repository may not be the configuration deployed, and
a route that's configured correctly can still fail to deliver.
`ac delivery verify` checks both against a disposable RabbitMQ through its
management API:

```bash
ac delivery verify . --url http://guest:guest@localhost:15672 --disposable --out delivery-report
```

1. It reads `/api/definitions` and compares it with what the repository
   declares. A missing exchange, queue or route fails, and so does a binding
   with different arguments, or a queue whose deployed delivery limit,
   dead-letter exchange, TTL, idle expiry or length limit differs from the
   declared one. Only RabbitMQ routes are compared.
2. It publishes each committed example with a unique correlation ID. An example
   the bindings accept must reach the consumer's queue within `--deadline`
   (5 seconds). An example they reject must stay absent for `--window`
   (1.5 seconds), and only counts when a matching message arrived in the same
   run, because absence on its own proves nothing.
3. It takes a matching message off the consumer's queue and rejects it without
   requeueing, as a failing consumer would. The message must reach the
   dead-letter queue.
4. It fails a message once, requeueing it, and the retry must come back marked
   as redelivered. On a queue with an attempt limit of 10 or fewer, it keeps
   failing a message until the broker gives up. The message must reach the
   dead-letter queue after exactly one more delivery than the limit, which is
   when RabbitMQ gives up.

It takes messages off the consumer queues and rejects them, so it refuses to
run without `--disposable`.

`--out` writes `delivery-verification.json` and `.md`:

```text
| PASS | declared route payments → ledger.payments exists | infrastructure/rabbitmq/definitions.json:41 |
| PASS | matching example example-1 reaches LedgerService | correlation 9f3c…, queue ledger.payments, after 23ms |
| PASS | rejected example example-2 is excluded | correlation 2c98…, queue ledger.payments, watched 1500ms |
| PASS | failed processing reaches ledger.dead-letter | correlation 29d7…, queue ledger.dead-letter, after 1593ms |
| PASS | consumer recovers: a message LedgerService failed once is redelivered and processed | correlation 96eb…, queue ledger.payments, after 1650ms |
| PASS | a message that keeps failing reaches ledger.dead-letter after 4 deliveries (delivery limit 3) | correlation 4700…, queue ledger.dead-letter, after 2024ms |
| NOT TESTED | retention expiry over time | |
| UNKNOWN | whether PaymentService's own identity can publish: tested as the management user | |
```

The artifact records the configuration revision, the broker version and, for
each check, its correlation ID, queue and source line. It never includes a
message body. A pass means these scenarios worked against this configuration
at this time.

## Limits

- `ac delivery verify` runs against RabbitMQ. Routes on SNS, SQS, EventBridge,
  Kafka and Service Bus are analysed and checked in pull requests, and the
  report lists them as not tested live.
- Live checks publish as the management user, so whether each service's own
  identity can publish or consume is checked from the configuration, not
  proven.
- Retention expiry, redelivery delays, throughput and outage recovery need
  longer tests than a pull request runs.
- Terraform and Bicep source are not read: export Bicep to ARM, or keep the
  broker's own export (`definitions.json`) beside the code.
