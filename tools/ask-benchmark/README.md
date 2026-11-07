# Ask benchmark

Thirty questions with known answers, against the made-up company in
`examples/docs-demo/repos`. It measures whether `ask` finds the right page and
whether it says so when nothing does. Results come from string checks, so no model
marks its own work.

```bash
pnpm install
pnpm --filter autocatalog-mcp build
node run.mjs --tier retrieval                    # no model, free
node --env-file=.env run.mjs --tier agent --model beam-free  # needs OPENCODE_API_KEY
```

The `holdout` set uses everyday wording. Keep it out of tuning: run it to measure,
and do not change code or the demo to pass one of its questions. Eight questions have
no answer, and a confident reply to one counts as `made-up`.

The agent tier sends the demo content to the model provider, so keep real company
content out of `examples/docs-demo/repos`.

## Results

Retrieval, one run of all thirty:

| Run                | Dev   | Holdout | Made up |
| ------------------ | ----- | ------- | ------- |
| Baseline           | 18/18 | 4/12    | 0       |
| Stems and contents | 18/18 | 5/12    | 0       |

Retrieval scores the first page of results, so it cannot credit `contents`, which an
agent reads on a miss. The agent tier measures that.

Agent, `beam-free`, the 18 dev questions three times each:

| Run                | Answerable | No answer exists | Made up | Rate limited |
| ------------------ | ---------- | ---------------- | ------- | ------------ |
| Baseline           | 29/39      | 10/15            | 0       | 5            |
| Stems and contents | 39/39      | 12/15            | 1       | 2            |

Rate-limited rows count as unanswered. The baseline server is the first `ask`, before stems
and `contents`. Both runs used the same harness: six steps, a final step that asks for the answer, and
`NOT FOUND` accepted anywhere on the last line. The holdout set has no agent score yet,
because the free tier's rate limit stopped those runs. The `-agent.json` files show
those rows as `error`.

This is a made-up company and thirty questions. It shows direction, and it says nothing
about any real company's documents.
