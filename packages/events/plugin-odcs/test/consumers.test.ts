import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkConsumers, runConsumers } from '../src/index';

const provider = (freshnessHours: number, statuses: string[]) => `
apiVersion: v3.2.0
kind: DataContract
id: customers
version: 1.0.0
status: active
schema:
  - name: customers
    properties:
      - { name: customer_id, logicalType: string, primaryKey: true }
      - name: customer_status
        logicalType: string
        quality:
          - { metric: invalidValues, arguments: { validValues: [${statuses.join(', ')}] }, mustBe: 0 }
slaProperties:
  - { property: freshness, value: ${freshnessHours}, unit: hours, element: customers.customer_id }
`;

const expectation = `
apiVersion: v3.2.0
kind: DataContract
id: cross-sell-inputs
version: 1.0.0
status: active
schema:
  - name: customers
    properties:
      - { name: customer_id, logicalType: string }
      - name: customer_status
        quality:
          - { metric: invalidValues, arguments: { validValues: [active, lapsed, cancelled] }, mustBe: 0 }
slaProperties:
  - { property: freshness, value: 2, unit: day, element: customers.customer_id }
`;

let root: string;

let log: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'odcs-consumers-'));
  log = [];

  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void log.push(args.join(' ')));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

async function repos(v1: string, v2?: string) {
  await write('crm/datacontracts/customers_v1.odcs.yaml', v1);

  const outputs = [
    '  - { ref: data-product/cross-sell, contract: datacontracts/customers_v1.odcs.yaml }',
  ];

  if (v2) {
    await write('crm/datacontracts/customers_v2.odcs.yaml', v2);
    outputs.push(
      '  - { ref: data-product/cross-sell, contract: datacontracts/customers_v2.odcs.yaml }',
    );
  }

  await write(
    'crm/data-products/customers.md',
    `---\nname: Customers\noutputs:\n${outputs.join('\n')}\n---\n`,
  );
  await write('analytics/expectations/cross-sell.odcs.yaml', expectation);
  await write(
    'analytics/data-products/cross-sell.md',
    '---\nname: Cross-sell\ninputs:\n  - { ref: data-product/customers, contract: expectations/cross-sell.odcs.yaml }\n---\n',
  );

  return [
    { repository: 'crm', dir: path.join(root, 'crm') },
    { repository: 'analytics', dir: path.join(root, 'analytics') },
  ];
}

it('is met when the provider promises at least what the consumer expects', async () => {
  const { results, failures } = checkConsumers(await repos(provider(24, ['active', 'lapsed'])));
  expect(failures).toEqual([]);
  expect(results).toEqual([
    expect.objectContaining({
      consumer: expect.objectContaining({ id: 'cross-sell', repository: 'analytics' }),
      provider: expect.objectContaining({ id: 'customers', repository: 'crm' }),
      metBy: 'datacontracts/customers_v1.odcs.yaml',
      unmet: [],
    }),
  ]);
  expect(runConsumers(path.join(root, 'crm'), [path.join(root, 'analytics')])).toBe(0);
});

it('names the consumer a provider change breaks, and what it no longer gets', async () => {
  await repos(provider(72, ['active', 'lapsed', 'frozen']));
  expect(runConsumers(path.join(root, 'crm'), [path.join(root, 'analytics')])).toBe(1);
  const out = log.join('\n');
  expect(out).toContain(
    '✗ breaks Cross-sell (analytics/data-products/cross-sell.md): no output of Customers (crm) meets expectations/cross-sell.odcs.yaml',
  );
  expect(out).toContain('sla.freshness:customers.customer_id: 2 day → 72 hours');
  expect(out).toContain('customers.customer_status.quality[library:invalidValues]');
});

it('is met by any one output: a consumer still on v1 is fine while v1 is published', async () => {
  const { results } = checkConsumers(
    await repos(provider(24, ['active']), provider(72, ['active', 'frozen'])),
  );

  expect(results[0]).toMatchObject({ metBy: 'datacontracts/customers_v1.odcs.yaml' });
});

it('fails when a provider contract a consumer depends on goes missing', async () => {
  await repos(provider(24, ['active', 'lapsed']));
  await fs.rm(path.join(root, 'crm/datacontracts/customers_v1.odcs.yaml'));
  expect(runConsumers(path.join(root, 'crm'), [path.join(root, 'analytics')])).toBe(1);
  expect(log.join('\n')).toContain('✗ crm/data-products/customers.md');
});

it('checks an ODPS consumer pinned to v1 of a contract, by id and version', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'crm/data-products/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: customers\nstatus: active\noutputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
  );
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: cross-sell\nstatus: active\ninputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
  );
  const crm = path.join(root, 'crm');
  const analytics = path.join(root, 'analytics');
  expect(runConsumers(crm, [analytics])).toBe(0);
  expect(log.join('\n')).toContain('✓ cross-sell');

  // v1 is replaced by v2: the consumer pinned to v1 fails, by name.
  await fs.writeFile(
    path.join(crm, 'datacontracts/customers_v1.odcs.yaml'),
    provider(24, ['active']).replace('version: 1.0.0', 'version: 2.0.0'),
  );
  await write(
    'crm/data-products/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: customers\nstatus: active\noutputPorts:\n  - { name: customers, version: 2.0.0, contractId: customers }\n',
  );
  log.length = 0;
  expect(runConsumers(crm, [analytics])).toBe(1);
  expect(log.join('\n')).toContain(
    "analytics/data-products/cross-sell.odps.yaml: input port 'customers' reads contract customers 1.0.0, which no data product publishes",
  );
  expect(log.join('\n')).not.toContain('crm/data-products/customers.odps.yaml');
});

const odps = (id: string, ports: string) =>
  `apiVersion: v1.1.0\nkind: DataProduct\nid: ${id}\nstatus: active\n${ports}`;

it('fails an ODPS input pinned to a version the provider does not keep', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'crm/data-products/customers.odps.yaml',
    odps(
      'customers',
      'outputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    odps(
      'cross-sell',
      'inputPorts:\n  - { name: customers, version: 1.5.0, contractId: customers }\n',
    ),
  );

  expect(runConsumers(path.join(root, 'crm'), [path.join(root, 'analytics')])).toBe(1);
  expect(log.join('\n')).toContain(
    "input port 'customers' reads contract customers 1.5.0, which no data product publishes",
  );
});

it('fails an ODPS input once no data product publishes its contract', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    odps(
      'cross-sell',
      'inputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );

  expect(runConsumers(path.join(root, 'crm'), [path.join(root, 'analytics')])).toBe(1);
  expect(log.join('\n')).toContain(
    'reads contract customers 1.0.0, which no data product publishes',
  );
});

it('resolves a pinned input to the product that publishes it, whichever checkout is read first', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'crm/data-products/customers.odps.yaml',
    odps(
      'customers',
      'outputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );
  // The consumer keeps its own copy of the contract it reads.
  await write('analytics/vendored/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    odps(
      'cross-sell',
      'inputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );

  const crm = path.join(root, 'crm');
  const analytics = path.join(root, 'analytics');

  expect(runConsumers(crm, [analytics])).toBe(0);
  expect(runConsumers(analytics, [crm])).toBe(0);
});

it('reports the output an exact pin resolved to, not another that also meets it', async () => {
  await write(
    'crm/datacontracts/customers_v2.odcs.yaml',
    provider(24, ['active']).replace('version: 1.0.0', 'version: 2.0.0'),
  );
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'crm/data-products/customers.odps.yaml',
    odps(
      'customers',
      'outputPorts:\n  - { name: customers-v2, version: 2.0.0, contractId: customers }\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    odps(
      'cross-sell',
      'inputPorts:\n  - { name: customers, version: 1.0.0, contractId: customers }\n',
    ),
  );

  const { results, failures } = checkConsumers([
    { repository: 'crm', dir: path.join(root, 'crm') },
    { repository: 'analytics', dir: path.join(root, 'analytics') },
  ]);

  expect(failures).toEqual([]);
  expect(results).toEqual([
    expect.objectContaining({ metBy: 'datacontracts/customers_v1.odcs.yaml', unmet: [] }),
  ]);
});

it('checks the provider the catalog resolves to, past one that fails its own checks', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', provider(24, ['active']));
  await write(
    'crm/datacontracts/customers_v2.odcs.yaml',
    provider(24, ['active']).replace('version: 1.0.0', 'version: 2.0.0'),
  );
  await write(
    'crm/datacontracts/feed.odcs.yaml',
    provider(24, ['active']).replace('id: customers', 'id: feed'),
  );
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

  const { results, failures } = checkConsumers([
    { repository: 'crm', dir: path.join(root, 'crm') },
    { repository: 'analytics', dir: path.join(root, 'analytics') },
  ]);

  expect(failures).toEqual([
    "crm/data-products/customers-next.odps.yaml: input port 'feed' reads contract feed, which no data product publishes",
  ]);
  expect(results).toEqual([
    expect.objectContaining({
      consumer: expect.objectContaining({ id: 'cross-sell' }),
      provider: expect.objectContaining({ id: 'customers' }),
      metBy: 'datacontracts/customers_v1.odcs.yaml',
    }),
  ]);
});
