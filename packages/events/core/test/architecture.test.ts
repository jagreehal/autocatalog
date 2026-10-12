import type { JsonObject } from '../src/json';
import { describe, expect, it } from 'vitest';
import {
  discoverTraceResources,
  datastoreOwnership,
  promoteRelationship,
  architectureConflicts,
  mergeArchitectureGraphs,
  architectureService,
  architectureResource,
  emptyResourceGraph,
  combineEvidence,
} from '../src/architecture';
import { readResourceGraph, writeResourceGraph } from '../src/resource-store';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('competing facts from two sources', () => {
  const collection = (schema: JsonObject, team?: string) => {
    const graph = emptyResourceGraph();

    const resource = architectureResource(
      { kind: 'collection', namespace: 'main/app', id: 'statements' },
      { schema },
    );

    resource.provenance = { default: 'extracted', fields: {} };
    resource.needsReview = false;

    if (team) resource.owner = { team };
    graph.resources.push(resource);

    return graph;
  };

  it('keeps a resource whose sources disagree on its schema, without either schema, for review', () => {
    const left = collection({ type: 'object', properties: { amount: { type: 'number' } } });
    const right = collection({ type: 'object', properties: { amount: { type: 'string' } } });

    const [merged] = mergeArchitectureGraphs(left, right).resources;

    expect(merged?.attributes).not.toHaveProperty('schema');
    expect(merged).toMatchObject({
      provenance: { default: 'inferred', fields: {} },
      needsReview: true,
    });
    expect(architectureConflicts(left, right)).toEqual([
      'collection main/app/statements: sources disagree on its schema; it is left out until they agree',
    ]);
  });

  it('keeps the better-sourced owner when sources disagree, and says so', () => {
    const left = collection({ type: 'object' }, 'ledger');
    const right = collection({ type: 'object' }, 'billing');

    const [merged] = mergeArchitectureGraphs(left, right).resources;

    expect(merged).toMatchObject({ owner: { team: 'ledger' }, needsReview: true });
    expect(architectureConflicts(left, right)).toEqual([
      'collection main/app/statements: sources disagree on its owner (ledger, billing); ledger is kept',
    ]);
  });

  it('reports nothing when sources agree', () => {
    const left = collection({ type: 'object', properties: { a: { type: 'string' } } }, 'ledger');
    const right = collection({ properties: { a: { type: 'string' } }, type: 'object' }, 'ledger');

    expect(architectureConflicts(left, right)).toEqual([]);
    expect(mergeArchitectureGraphs(left, right).resources[0]).toMatchObject({ needsReview: false });
  });
});

describe('architecture discovery', () => {
  it('merges service domains and equivalent schemas without losing existing catalog context', () => {
    const left = emptyResourceGraph();
    const right = emptyResourceGraph();
    const service = architectureService('billing');
    service.attributes.domains = ['ledger'];
    left.resources.push(
      service,
      architectureResource(
        { kind: 'collection', id: 'statements' },
        { schema: { type: 'object', properties: { amount: { type: 'number' } } } },
      ),
    );
    right.resources.push(
      architectureService('billing'),
      architectureResource(
        { kind: 'collection', id: 'statements' },
        { schema: { properties: { amount: { type: 'number' } }, type: 'object' } },
      ),
    );
    const graph = mergeArchitectureGraphs(right, left);
    expect(
      graph.resources.find((resource) => resource.ref.kind === 'service')?.attributes,
    ).toMatchObject({ domains: ['ledger'] });
    expect(graph.resources.filter((resource) => resource.ref.kind === 'collection')).toHaveLength(
      1,
    );
  });
  it('discovers who reads and writes a collection without any declared schema', () => {
    const graph = discoverTraceResources(
      {
        resourceSpans: ['billing', 'reporting'].map((service, index) => ({
          resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: index === 0 ? 'trace-write' : 'trace-read',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000001000000000',
                  attributes: [
                    { key: 'db.system.name', value: { stringValue: 'mongodb' } },
                    { key: 'db.namespace', value: { stringValue: 'finance' } },
                    { key: 'db.collection.name', value: { stringValue: 'statements' } },
                    {
                      key: 'db.operation.name',
                      value: { stringValue: index === 0 ? 'insert' : 'find' },
                    },
                  ],
                },
              ],
            },
          ],
        })),
      },
      { datastore: 'acme-main', environment: 'production' },
    );

    expect(datastoreOwnership(graph)).toEqual([
      expect.objectContaining({
        ref: { kind: 'collection', namespace: 'acme-main/finance', id: 'statements' },
        writers: ['billing'],
        readers: ['reporting'],
        owner: null,
      }),
    ]);
    expect(
      graph.resources.find((resource) => resource.ref.kind === 'collection')?.attributes,
    ).not.toHaveProperty('schema');
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'writes',
          provenance: 'observed',
          evidence: expect.objectContaining({
            count: 1,
            sampleTraceIds: ['trace-write'],
            environment: 'production',
          }),
        }),
      ]),
    );
  });
  it('discovers queue participants without misclassifying queue jobs as events or commands', () => {
    const graph = discoverTraceResources({
      resourceSpans: ['billing', 'worker'].map((service, index) => ({
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [
          {
            spans: [
              {
                attributes: [
                  { key: 'messaging.system', value: { stringValue: 'aws_sqs' } },
                  { key: 'messaging.destination.name', value: { stringValue: 'statement-jobs' } },
                  {
                    key: 'messaging.operation.type',
                    value: { stringValue: index ? 'process' : 'send' },
                  },
                ],
              },
            ],
          },
        ],
      })),
    });

    expect(graph.resources.filter((resource) => resource.ref.kind === 'queue')).toHaveLength(1);
    expect(
      graph.resources.some((resource) => ['event', 'command'].includes(resource.ref.kind)),
    ).toBe(false);
    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'sends',
        from: { kind: 'service', id: 'billing' },
        to: { kind: 'queue', namespace: 'aws_sqs', id: 'statement-jobs' },
      }),
    );
    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'consumes',
        from: { kind: 'queue', namespace: 'aws_sqs', id: 'statement-jobs' },
        to: { kind: 'service', id: 'worker' },
      }),
    );
  });
  it('discovers a service call through trace parentage and preserves a promoted declaration on disk', async () => {
    const graph = discoverTraceResources({
      resourceSpans: ['gateway', 'billing'].map((service, index) => ({
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'call-trace',
                spanId: index ? 'server' : 'client',
                parentSpanId: index ? 'client' : undefined,
                kind: index ? 2 : 3,
              },
            ],
          },
        ],
      })),
    });

    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'calls',
        from: { kind: 'service', id: 'gateway' },
        to: { kind: 'service', id: 'billing' },
        provenance: 'observed',
      }),
    );
    const promoted = promoteRelationship(graph, graph.relationships[0]!);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-resources-'));

    try {
      await writeResourceGraph(root, promoted);
      const loaded = await readResourceGraph(root);
      expect(loaded?.relationships[0]).toMatchObject({
        provenance: 'declared',
        needsReview: false,
        evidence: { sampleTraceIds: ['call-trace'] },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('counts each trace export once when evidence is combined', () => {
    const fromExport = (id: string, count: number, traceId: string) => ({
      count,
      sampleTraceIds: [traceId],
      coverage: 'unknown' as const,
      exports: [{ id, count }],
    });

    const a = fromExport('export-a', 2, 'trace-a');
    const b = fromExport('export-b', 3, 'trace-b');
    const both = combineEvidence(a, b);

    expect(both).toEqual({
      count: 5,
      sampleTraceIds: ['trace-a', 'trace-b'],
      operations: [],
      coverage: 'unknown',
      exports: [
        { id: 'export-a', count: 2 },
        { id: 'export-b', count: 3 },
      ],
    });
    expect(combineEvidence(both, b)?.count).toBe(5);
    expect(combineEvidence(b, both)?.count).toBe(5);
    expect(
      combineEvidence(both, { count: 4, sampleTraceIds: [], coverage: 'unknown' })?.count,
    ).toBe(9);
  });

  it('attributes discovered evidence to a digest of the export', () => {
    const traces = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'billing' } }] },
          scopeSpans: [
            {
              spans: ['t1', 't2'].map((traceId) => ({
                traceId,
                attributes: [
                  { key: 'db.system', value: { stringValue: 'mongodb' } },
                  { key: 'db.mongodb.collection', value: { stringValue: 'statements' } },
                  { key: 'db.operation', value: { stringValue: 'insert' } },
                ],
              })),
            },
          ],
        },
      ],
    };

    const first = discoverTraceResources(traces).relationships[0]!.evidence!;
    const again = discoverTraceResources(traces).relationships[0]!.evidence!;

    expect(first.count).toBe(2);
    expect(first.exports).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{16}$/), count: 2 }]);
    expect(again.exports).toEqual(first.exports);
    expect(combineEvidence(first, again)?.count).toBe(2);
  });
});
