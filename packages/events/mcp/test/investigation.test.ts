import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { applySnapshot, publishCatalog, readSnapshot, type AdapterEvent } from 'autocatalog-core';
import { createServer } from '../src/server.js';
import { describeEvent, investigationBundle, loadCatalog, resolveEvent } from '../src/tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const event = (domain = 'payments'): AdapterEvent => ({
  id: 'payment.completed',
  domain,
  version: '1.0.0',
  name: 'Payment completed',
  summary: 'Payment succeeded',
  folderName: 'PaymentCompleted',
  examples: [],
  meta: { producers: ['PaymentService'], consumers: ['LedgerService', 'NotificationService'] },
  schema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
});

async function fixture(withSnapshot = true, duplicate = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-investigation-'));
  roots.push(root);
  const events = duplicate ? [event(), event('billing')] : [event()];

  if (withSnapshot) {
    const file = path.join(root, 'snapshot.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        spec: 'autotel-architecture/v0.1.0',
        generatedAt: '2026-10-10T12:00:00Z',
        service: 'payments',
        events: {
          'payment.completed': {
            name: 'payment.completed',
            observedCount: 8,
            firstSeen: '2026-10-10T11:00:00Z',
            lastSeen: '2026-10-10T11:59:00Z',
            producer: 'PaymentService',
            consumers: ['LedgerService', 'FraudService'],
            sampleTraceIds: ['trace-1', 'trace-1', 'trace-2', 'trace-3', 'trace-4'],
            sources: [
              {
                producer: 'PaymentService',
                channel: 'payments',
                count: 5,
                firstSeen: '2026-10-10T11:00:00Z',
                lastSeen: '2026-10-10T11:59:00Z',
              },
              {
                producer: 'RetryService',
                channel: 'retries',
                count: 3,
                firstSeen: '2026-10-10T11:30:00Z',
                lastSeen: '2026-10-10T11:58:00Z',
              },
            ],
            fieldPaths: ['amount'],
            fieldStats: { amount: { types: ['number'], sampleValues: [999] } },
          },
        },
      }),
    );
    applySnapshot(events, await readSnapshot(file));
  }

  await publishCatalog({ outRoot: path.join(root, 'events'), events });

  return loadCatalog(path.join(root, 'events'), root);
}

describe('catalog to telemetry investigation', () => {
  it('preserves autotel evidence through publication and supplies bounded queries without payload samples', async () => {
    const catalog = await fixture();

    const bundle = investigationBundle(catalog, 'payments/payment.completed', 'amount', {
      type: 'object',
      properties: {},
    });

    expect(bundle.change?.hasBreaking).toBe(true);
    expect(bundle.change?.notify).toEqual(['FraudService', 'LedgerService', 'NotificationService']);
    expect(bundle.evidence).toMatchObject({
      status: 'snapshot',
      count: 8,
      consumerEvidence: 'reported',
      coverage: 'unknown',
      declaredConsumers: ['LedgerService', 'NotificationService'],
      additionalConsumers: ['FraudService'],
      neverObserved: ['NotificationService'],
      observedProducers: ['PaymentService', 'RetryService'],
      fieldTypes: { amount: ['number'] },
      sampleTraceIds: ['trace-1', 'trace-2', 'trace-3'],
    });
    expect(
      bundle.evidence.status === 'snapshot' &&
        bundle.evidence.sources.map((source) => source.count),
    ).toEqual([5, 3]);
    expect(bundle.telemetry.traceQueries).toHaveLength(3);
    expect(bundle.telemetry.traceQueries[0]).toEqual({
      tool: 'summarize_trace',
      arguments: { traceId: 'trace-1' },
      requires: ['traces'],
    });
    expect(bundle.telemetry.preflight.map((query) => query.tool)).toEqual([
      'backend_health',
      'backend_capabilities',
    ]);
    expect(JSON.stringify(bundle)).not.toContain('sampleValues');
    expect(describeEvent(catalog, 'payment.completed').runtime).toEqual(bundle.evidence);
    expect(bundle.impact.runtime?.snapshot.generatedAt).toBe('2026-10-10T12:00:00Z');
  });

  it('keeps absent evidence distinct from zero traffic and offers discovery without guessed filters', async () => {
    const bundle = investigationBundle(await fixture(false), 'payment.completed');
    expect(bundle.evidence.status).toBe('no-evidence');
    expect(bundle.telemetry.traceQueries).toEqual([]);
    expect(bundle.telemetry.scope).toEqual({
      environment: 'unknown',
      release: 'unknown',
      backend: 'unknown',
    });
    expect(bundle.telemetry.discovery.tool).toBe('list_services');
    expect(bundle.impact.notify).toEqual(['LedgerService', 'NotificationService']);
  });

  it('rejects ambiguous shorthand rather than investigating the wrong event', async () => {
    const catalog = await fixture(false, true);
    expect(() => resolveEvent(catalog, 'payment.completed')).toThrow(/Ambiguous event/);
    expect(investigationBundle(catalog, 'billing/payment.completed').resource.namespace).toBe(
      'billing',
    );
  });

  it('exposes the handoff through MCP and reports lookup failures as tool errors', async () => {
    const server = createServer(await fixture());
    const client = new Client({ name: 'investigation-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(
        tools.tools.find((tool) => tool.name === 'get_investigation_bundle')?.annotations
          ?.readOnlyHint,
      ).toBe(true);

      const result = await client.callTool({
        name: 'get_investigation_bundle',
        arguments: { ref: 'payment.completed' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('autocatalog-investigation/v1'),
        }),
      ]);

      const missing = await client.callTool({
        name: 'get_investigation_bundle',
        arguments: { ref: 'missing' },
      });

      expect(missing.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
