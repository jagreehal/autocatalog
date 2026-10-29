---
name: autocatalog-investigate
description: Investigate event failures or verify event contract changes using autocatalog-mcp for contracts and impact, and autotel-mcp for traces, logs and metrics. Use when both catalog context and runtime evidence are needed.
---

# Investigate contracts and runtime behaviour

Use autocatalog to establish the declared contract, source and affected consumers.
Use autotel to investigate what ran. Keep the two kinds of evidence identifiable.

## Start with a bounded handoff

Call autocatalog `get_investigation_bundle` with a qualified event reference and,
when relevant, a field path and proposed JSON Schema:

```json
{ "ref": "payments/payment.completed", "field": "amountMinor" }
```

The bundle includes catalog freshness, impact, optional compatibility findings,
snapshot evidence and suggested autotel calls. It does not query autotel itself.
Use `schema` for the complete proposed schema, not a partial patch.

If the event is unknown, use catalog search to resolve it. If the reference is
ambiguous, choose a qualified alternative based on source and repository context.
Do not select the first match. If the catalog is stale, establish the correct
revision before relying on its impact or compatibility results.

## Follow the evidence into autotel

Inspect the connected autotel server's tool list. Run `backend_health` and
`backend_capabilities` before interpreting results. Backend identity, environment
and release are unknown in a snapshot bundle; establish them from configuration
and telemetry. Treat fixture data as a demonstration, not production evidence.

After confirming scope, use the suggested `summarize_trace` calls. Fetch the
full trace only when its summary is insufficient. Use `correlate` where available;
check availability of each returned signal. Trace-linked logs support correlation;
metrics from the same service/time are context, not proof of causation.

If references are absent or expired, use `list_services` to resolve the bundle's
service candidates to actual backend identities. Names such as `agent/<id>` and
`tool/<id>` are catalog participants, not automatically OTel services. Search a
bounded time window for the confirmed service, then inspect representative traces
and logs. Discover event attributes and metric names from actual telemetry rather
than assuming a universal `event.name` tag or inventing a metric.

When the bundle's evidence lists `consumerOutcomes`, start there: a consumer's
`failed`, `retried`, `deadLettered` and `replayed` counts, and its
`deadLetterReasons`, say which consumer is failing and why. Tell a transient
cause (a provider was down) from a poison message (one that will never
succeed) before suggesting a replay.

Distinguish unsupported signals, failed queries, expired references and empty
results. If autotel is unavailable, report the catalog and snapshot findings with
the runtime verification still unresolved.

## Verify an authorized change

Use the bundle's compatibility findings, or `check_change`, before editing a
contract. Runtime inactivity does not remove declared consumers from impact.
An observed field type does not establish every constraint in the JSON Schema.

For an authorized fix, follow catalog source links, run the relevant tests and
collect a fresh snapshot or inspect telemetry from that test execution. Compare
the original failure with the new execution using trace IDs, release/test-run
identity and timestamps. Regenerate the catalog through its scan workflow if the
contract changed; do not hand-edit generated manifests. To attach the fresh snapshot:

```bash
ac scan --snapshot .autotel/snapshot.json
```

## Anti-patterns

A passing test, compatible contract and observed successful interaction are
separate claims. Describe which were verified and which remain unknown. Consumer
metadata marked `reported` is not proof that the consumer processed a message.
An absent consumer is not evidence that it can be removed.

When handing the investigation to another developer, retain the bundle's catalog
revision, snapshot generation time, chosen backend/environment/release, query
window and evidence references. Keep credentials and raw sensitive payloads out
of shared artifacts. This workflow does not authorize production changes or
sending messages to owners.
