import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { jsonObjectSchema } from '../src/json';
import { AUTOCATALOG_GRAPH_SPEC, type ResourceGraph } from '../src/resource-graph';

// The committed contract, not a restatement of it: the same file the package
// publishes, so a Python or Go adapter is held to exactly what this checks.
const schemaFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../contracts/graph-v1.schema.json',
);

const schema = jsonObjectSchema.parse(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const graph: ResourceGraph = {
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources: [
    {
      ref: { kind: 'event', namespace: 'payments', id: 'payment.completed', version: '1.0.0' },
      title: 'Payment Completed',
      summary: 'Fires when a payment completes',
      url: '/events/payments/payment.completed',
      owner: { team: 'Billing' },
      tags: ['pci'],
      provenance: { default: 'extracted', fields: { producers: 'declared' } },
      confidence: 0.9,
      needsReview: false,
      source: { type: 'code', file: 'src/events/payment.ts', line: 7 },
      attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 1 },
    },
    {
      ref: { kind: 'repository', id: 'payments-service' },
      title: 'payments-service',
      tags: [],
      provenance: { default: 'inferred', fields: {} },
      needsReview: false,
      attributes: {},
    },
  ],
  relationships: [
    {
      type: 'produces',
      from: { kind: 'service', id: 'PaymentService' },
      to: { kind: 'event', namespace: 'payments', id: 'payment.completed', version: '1.0.0' },
      provenance: 'declared',
      needsReview: false,
    },
  ],
};

describe('autocatalog/graph-v1 contract', () => {
  it('accepts a graph the adapters actually produce', () => {
    expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a graph claiming a spec it does not implement', () => {
    expect(validate({ ...graph, spec: 'autocatalog/graph-v2' })).toBe(false);
  });

  it('rejects provenance outside the four states', () => {
    // The whole promise is that a reader can tell a guess from a fact. A fifth
    // value would mean something no consumer knows how to weigh.
    const resources = [
      { ...graph.resources[0]!, provenance: { default: 'assumed', fields: {} } },
      ...graph.resources.slice(1),
    ];

    expect(validate({ ...graph, resources })).toBe(false);
  });

  it('rejects a relationship with no evidence attached', () => {
    const { provenance, ...unevidenced } = graph.relationships[0]!;
    expect(provenance).toBeDefined();
    expect(validate({ ...graph, relationships: [unevidenced] })).toBe(false);
  });
});
