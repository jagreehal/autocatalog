# Default starter — Refund Agent scenario

A complete example catalog using all seven agent architecture primitives in autocatalog.

## The scenario

A customer-support team runs two agents:

- **triage-agent** — reads incoming support tickets and decides what to do
- **refund-agent** — handles refund requests end-to-end

Together they form the `support-triage` Workflow. Both Agents reference shared Tools (`issue-refund`, `send-email`, `lookup-order`), and the refund agent must comply with `refund-policy` and `vip-escalation`.

## Layout

```
domains/support/          — the owning Domain
models/                   — claude-opus-4-7, claude-haiku-4-5
tools/                    — issue-refund, send-email, lookup-order
agents/                   — triage-agent, refund-agent (+ prompts/)
policies/                 — refund-policy, vip-escalation
workflows/                — support-triage
evals/                    — refund-agent-correctness (+ cases.yaml)
```
