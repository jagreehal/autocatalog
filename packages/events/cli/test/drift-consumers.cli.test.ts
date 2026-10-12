import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  createConsumerResourceGraph,
  type EventCatalogResource,
  type ResourceGraph,
} from 'autocatalog-core';
import { runDrift } from '../src/commands/drift';

const here = path.dirname(fileURLToPath(import.meta.url));

const starter = path.resolve(here, '../../../../fixtures/event-starter/events');

// Teams in other repositories say what they consume; the company site joins
// that up, and the producer's pull request reads it back.

const published = {
  ref: {
    kind: 'event' as const,
    namespace: 'payments-service/payments',
    id: 'payment.completed',
    version: '1.0.0',
  },
  domain: 'payments',
  id: 'payment.completed',
  repository: 'payments-service',
};

const event: EventCatalogResource = {
  ref: published.ref,
  title: 'Payment Completed',
  tags: [],
  provenance: { default: 'declared', fields: {} },
  needsReview: false,
  attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
};

const fraud = createConsumerResourceGraph(
  [{ service: 'FraudService', event: 'payments/payment.completed', fields: ['amount'] }],
  { repository: 'fraud', events: [published] },
);

const audit = createConsumerResourceGraph(
  [{ service: 'AuditService', event: 'payments/payment.completed', fields: ['currency'] }],
  { repository: 'audit', events: [published] },
);

const companyGraph: ResourceGraph = {
  spec: AUTOCATALOG_GRAPH_SPEC,
  resources: [event, ...fraud.resources, ...audit.resources],
  relationships: [...fraud.relationships, ...audit.relationships],
};

let work: string;

let baseline: string;

let current: string;

let index: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-drift-consumers-'));
  baseline = path.join(work, 'baseline');
  current = path.join(work, 'current');
  index = path.join(work, 'catalog.json');
  await fs.cp(starter, baseline, { recursive: true });
  await fs.cp(starter, current, { recursive: true });
  await fs.writeFile(index, JSON.stringify(companyGraph));

  // Rename amount, which FraudService reads and AuditService does not.
  const file = path.join(current, 'payments/PaymentCompleted/schema.json');
  const schema = JSON.parse(await fs.readFile(file, 'utf8'));
  schema.properties.amountMinor = schema.properties.amount;
  delete schema.properties.amount;
  schema.required = schema.required.map((field: string) =>
    field === 'amount' ? 'amountMinor' : field,
  );
  await fs.writeFile(file, JSON.stringify(schema));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(work, { recursive: true, force: true });
});

async function drift(consumers: string, extra: { consumersTokenEnv?: string } = {}) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const exit = await runDrift({ base: baseline, current, format: 'json', consumers, ...extra });

  const report = JSON.parse(String(log.mock.calls.at(-1)?.[0]));

  const renamed = report.findings.find(
    (finding: { kind: string }) => finding.kind === 'field_renamed',
  );

  return { exit, renamed, warned: warn.mock.calls.map((call) => String(call[0])).join('\n') };
}

describe('ac drift --consumers', () => {
  it('names a consumer another repository declares, when it reads the changed field', async () => {
    const { exit, renamed } = await drift(index);

    expect(exit).toBe(1);
    expect(renamed.consumers).toContain('FraudService');
    expect(renamed.consumers).not.toContain('AuditService');
    // The event's own consumers are still there.
    expect(renamed.consumers).toContain('LedgerService');
  });

  it('reads the index from the company site, sending a token when asked', async () => {
    const seen: Array<string | undefined> = [];

    const server = http.createServer((request, response) => {
      seen.push(request.headers.authorization);
      response.setHeader('content-type', 'application/json');
      response.setHeader('last-modified', 'Fri, 02 Jan 2026 03:04:05 GMT');
      response.end(JSON.stringify(companyGraph));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    // SAFETY: a server listening on a TCP port reports an AddressInfo.
    const { port } = server.address() as AddressInfo;
    vi.stubEnv('CATALOG_TOKEN', 'secret');

    try {
      const { renamed, warned } = await drift(`http://127.0.0.1:${port}/catalog.json`, {
        consumersTokenEnv: 'CATALOG_TOKEN',
      });

      expect(renamed.consumers).toContain('FraudService');
      expect(seen).toEqual(['Bearer secret']);
      expect(warned).toContain('published 2026-01-02T03:04:05Z');
    } finally {
      server.close();
    }
  });

  it('says when the index it read was published, so a stale one is seen', async () => {
    const published = new Date('2026-01-02T03:04:05Z');
    await fs.utimes(index, published, published);

    const { warned } = await drift(index);

    expect(warned).toContain(`consumers from ${index}, published 2026-01-02T03:04:05Z`);
    expect(warned).toMatch(/days ago\)/);
  });

  it('warns and still runs the gate when the index cannot be read', async () => {
    const { exit, renamed, warned } = await drift(path.join(work, 'missing.json'));

    expect(exit).toBe(1);
    expect(renamed.consumers).not.toContain('FraudService');
    expect(warned).toContain('missing.json');
  });

  it('refuses an index that is not a resource graph, and says so', async () => {
    await fs.writeFile(index, JSON.stringify({ hello: 'world' }));

    const { renamed, warned } = await drift(index);

    expect(renamed.consumers).not.toContain('FraudService');
    expect(warned).toMatch(/catalog\.json/);
  });
});
