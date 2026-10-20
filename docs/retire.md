---
title: Retiring a field
owner: Maintainers
summary: Whether you can remove a field or an event yet, consumer by consumer, with the evidence for each.
tags:
  - ci
related:
  - docs/drift-ci
  - docs/runtime-evidence
  - docs/rules
---

`ac drift` tells you that removing `amount` breaks three consumers. The next
question takes weeks: when can you remove it? `ac retire` answers it from the
evidence you already have, and the company site tracks every retirement under
way.

## Ask

```bash
ac retire payments/payment.completed amount \
  --catalog https://catalog.example.com/catalog.json \
  --snapshot .autotel/snapshot.json \
  --pacts https://pact-broker.example.com --pact-token-env PACT_BROKER_TOKEN
```

```text
## Removing `amount` from payments/payment.completed: blocked

- **LedgerService**: needs it. reads amount (payments-service); pact expects amount; failed verification against 9.1.0 (Pact Broker)
- **FraudService**: unknown. seen receiving the event (snapshot of 2026-10-01)
- **AuditService**: unspecified. declares no fields it reads (company index, default branches as of 2026-10-19)
- **BillingService**: clear. reads paymentId, not amount (payments-service)

Producer: still sent (snapshot of 2026-10-01).

Next: LedgerService moves off amount. Find out whether FraudService needs amount: it receives the event and declares nothing. AuditService declares the fields it reads, in autocatalog.consumes.json.
```

Leave out the field to ask about the whole event. The command exits 0 when
every consumer is clear and 1 otherwise, so a pull request that removes the
field can gate on it.

## Where each consumer stands

| Standing    | Means                                                                        | Blocks |
| ----------- | ---------------------------------------------------------------------------- | ------ |
| Needs it    | a declaration or a pact says it reads the field                              | yes    |
| Unknown     | a snapshot saw it receive the event, and nothing declares it a consumer      | yes    |
| Unspecified | it declares that it consumes the event, but not which fields it reads        | yes    |
| Clear       | it declares the fields it reads, or its pact shows them, and this is not one | no     |

Silence never clears a consumer. A source that names fields outranks one that
does not, so a pact settles a consumer that only declared the event. When two
sources that name fields disagree, the one that says it needs the field wins.

## The evidence

- **The event's own consumers**, from its manifest: `consumers` and
  `consumerFields`.
- **Other repositories' declarations**, from the company site's `/catalog.json`
  with `--catalog`. These are what each repository's default branch declares
  as of the site's last build, which the output dates. A declaration says what
  the code on that branch reads, not what is deployed. A consumer's own
  `autocatalog.consumes.json` counts beside what the producer wrote down for
  it, so a consumer that says it reads the field needs it.
- **A runtime snapshot**, with `--snapshot`: who was seen receiving the event,
  and whether the producer still sends the field.
- **Pacts**, with `--pacts`: a pact file, a folder of them, or a Pact Broker's
  base URL. A message counts when its description names the event, as
  `payment.completed` or `PaymentCompleted`. From a broker, each consumer's
  latest pact with the provider (`--pact-provider`, by default the event's first
  producer) and its latest verification come along. The broker is the place
  that knows which consumer versions are deployed; `ac retire` reports its
  verification as it found it. Pacts it could not read block the verdict: a
  broker that cannot be reached, a file that is not a pact, a message body that
  is encoded or not JSON, a link off the broker, more than 200 pacts, or no
  pact with a message for the event. The output lists them under missing
  evidence.

## Track it on the site

Mark the field `deprecated: true` in its schema, or the whole event
`status: deprecated`. The company site's **Retirements** page then lists each
one with where its consumers stand, from every repository's declarations and
snapshots, as of each build.

## Then remove it

When every consumer is clear, remove the field and bump the event's major
version. `ac drift` reports the removal as breaking, acknowledged by the major
version, and names who to tell.
