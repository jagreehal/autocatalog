# autocatalog-agents-adapter-autotel

Read OTLP JSON traces and diff observed agent behaviour against the declared catalog. Surfaces
drift like "Refund Agent called `update-crm` in production but never declared it" or "service
emitted spans as `mystery-agent` — not in the catalog."

Despite the name, this adapter consumes OTLP JSON from any source — [autotel](https://npmjs.com/package/autotel),
raw OpenTelemetry exporters, or replay files. Autotel is the reference producer because it ships
LLM- and tool-call instrumentation out of the box.

## What we extract per span

Resource-level or span-level: an `agent.id` attribute (also tried: `gen_ai.agent.id`, `service.name`).

Span-level:

- LLM calls — span name matches `llm|gen_ai|chat.completion|completion|inference` OR has a `gen_ai.request.model` (etc.) attribute
- Tool calls — span name matches `tool|function|call` OR has a `tool.name` (etc.) attribute

The model id and tool id come from the same attribute lookup. This is permissive on purpose — any
OTel-compliant emitter that follows the OpenLLMetry conventions will work, and you can extend the
key lists in `parse.ts` for your own conventions.

## Drift categories

| Kind                   | Meaning                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `unknown-agent`        | Agent observed in traces but not in catalog                                        |
| `undeclared-tool`      | Agent called a tool it didn't declare                                              |
| `unknown-tool`         | Observed tool id is not declared as a Tool entity                                  |
| `unused-declared-tool` | Agent declares a tool but never called it (in this trace window)                   |
| `model-mismatch`       | Agent declared model X but called model Y; catalog `model_id` aliases are accepted |
| `undeclared-model`     | Observed model id not in the catalog at all                                        |

## API

```ts
import { loadObservations, parseOtlpJson, computeDrift } from 'autocatalog-agents-adapter-autotel';
import { loadCatalog } from 'autocatalog-agents-core';

const cat = await loadCatalog('./my-catalog');
const obs = await loadObservations('./traces/recent.json');
const report = computeDrift(cat, obs);
console.log(report.drifts);
```

See also: `ac-agents drift <otlp-file>` CLI and MCP `drift` tool.
