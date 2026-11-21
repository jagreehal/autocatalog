import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { dataContract } from '../src/model.js';
import { loadCatalog } from '../src/tools.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-odcs-'));
});

afterEach(() => fs.rm(root, { recursive: true, force: true }));

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

it('gives an agent a data product’s contract, track record and AI context', async () => {
  await write(
    'events/payments/payment.captured/autocatalog.json',
    JSON.stringify({
      spec: 'autocatalog/v2',
      id: 'payment.captured',
      version: '1.0.0',
      name: 'payment.captured',
      summary: 'Captured.',
      domain: 'payments',
      schema: 'schema.json',
    }),
  );
  await write('events/payments/payment.captured/schema.json', '{"type":"object"}');
  await write(
    'datacontracts/revenue_v1.odcs.yaml',
    `apiVersion: v3.2.0
kind: DataContract
id: revenue
version: 1.0.0
status: active
schema:
  - name: revenue
    properties: [{ name: amount_cents, logicalType: integer, required: true }]
slaProperties: [{ property: freshness, value: 24, unit: hours, element: revenue.day }]
servers: [{ server: events, type: kafka, host: broker:9092, format: avro }]
context:
  instructions: Amounts are in cents.
  verifiedStatements: [{ question: Revenue yesterday?, answer: SELECT SUM(amount_cents) FROM revenue }]
`,
  );
  await write(
    'datacontracts/revenue_v1.results.ndjson',
    `${JSON.stringify({ at: '2026-11-19T06:00:00Z', contract: { id: 'revenue', version: '1.0.0' }, object: 'revenue', status: 'passed', sla: [{ property: 'freshness', element: 'revenue.day', status: 'kept' }] })}\n`,
  );
  await write(
    'data-products/revenue.md',
    '---\nname: Revenue\ninputs: [event/payments/payment.captured]\noutputs:\n  - { ref: event/payments/payment.captured, contract: datacontracts/revenue_v1.odcs.yaml }\n---\n',
  );

  const server = createServer(await loadCatalog(path.join(root, 'events')));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.callTool({ name: 'data_contract', arguments: {} });
  expect(JSON.stringify(listed.content)).toContain('revenue 1.0.0 (active)');

  const one = await client.callTool({ name: 'data_contract', arguments: { id: 'revenue' } });
  // SAFETY: data_contract answers with one text block, as asText writes it.
  const text = (one.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('Amounts are in cents.');
  expect(text).toContain('SELECT SUM(amount_cents) FROM revenue');
  expect(text).toContain('"kept":1,"measured":1');
  // The contract as written: connection details an agent needs to read the data.
  expect(text).toContain('"host":"broker:9092","format":"avro"');

  const missing = await client.callTool({ name: 'data_contract', arguments: { id: 'nope' } });
  expect(missing.isError).toBe(true);
  expect(JSON.stringify(missing.content)).toContain('With contracts: revenue');
});

it('answers across the company with the version the catalog resolves, past a provider that fails', async () => {
  const event = (repo: string) =>
    Promise.all([
      write(
        `${repo}/events/${repo}/${repo}.seen/autocatalog.json`,
        JSON.stringify({
          spec: 'autocatalog/v2',
          id: `${repo}.seen`,
          version: '1.0.0',
          name: `${repo}.seen`,
          summary: 'Seen.',
          domain: repo,
          schema: 'schema.json',
        }),
      ),
      write(`${repo}/events/${repo}/${repo}.seen/schema.json`, '{"type":"object"}'),
    ]);

  const contract = (id: string, version: string) =>
    `apiVersion: v3.2.0\nkind: DataContract\nid: ${id}\nversion: ${version}\nstatus: active\nschema:\n  - name: ${id}\n    properties: [{ name: id, logicalType: string }]\n`;

  const odps = (id: string, ports: string) =>
    `apiVersion: v1.1.0\nkind: DataProduct\nid: ${id}\nstatus: active\n${ports}`;

  await event('crm');
  await event('analytics');
  await write('crm/datacontracts/customers_v1.odcs.yaml', contract('customers', '1.0.0'));
  await write('crm/datacontracts/customers_v2.odcs.yaml', contract('customers', '2.0.0'));
  await write('crm/datacontracts/feed.odcs.yaml', contract('feed', '1.0.0'));
  await write(
    'crm/data-products/customers.odps.yaml',
    odps(
      'customers',
      'outputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );
  await write(
    'crm/data-products/customers-next.odps.yaml',
    odps(
      'customers-next',
      'inputPorts:\n  - { name: feed, contractId: feed }\noutputPorts:\n  - { name: customers, version: 2.0.0, contractId: customers }\n',
    ),
  );
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    odps('cross-sell', 'inputPorts:\n  - { name: customers, contractId: customers }\n'),
  );

  const catalog = await loadCatalog(path.join(root, 'analytics', 'events'));

  expect(dataContract(catalog, 'cross-sell', root).expects).toEqual([
    expect.objectContaining({
      input: 'data-product/customers',
      contract: 'datacontracts/customers_v1.odcs.yaml',
    }),
  ]);
});
