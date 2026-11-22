import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readDomainModel } from '../src/model';
import { readOdcs, readTrackRecord, trackRecordFile } from '../src/odcs';

const CUSTOMERS = `
apiVersion: v3.2.0
kind: DataContract
id: customers
name: Customers
version: 1.0.0
status: active
description:
  purpose: Provides customer master data for analytics and reporting
  limitations: Contains only customers with an active policy
schema:
  - name: customers
    physicalType: table
    quality: [{ type: sql, query: select count(*) from customers, mustBeGreaterThan: 100000 }]
    properties:
      - { name: customer_id, logicalType: string, primaryKey: true }
      - name: customer_name
        logicalType: string
        required: true
        classification: restricted
        quality: [{ type: sql, query: select 1, mustBeLessThan: 0.01 }]
slaProperties:
  - { property: retention, value: 5, unit: year }
  - { property: freshness, value: 24, unit: hours, element: customers.last_updated_at }
team: { name: customer-data, members: [{ username: carola@example.com, role: Owner }] }
support: [{ channel: '#customer-data-support', tool: slack }]
roles: [{ role: customers_reader, access: read }]
context:
  instructions: >
    Annual premiums are stored in cents.
  constraints:
    - constraint: Do not use this data to price a policy.
  verifiedStatements:
    - question: How many active customers do we have?
      answer: SELECT COUNT(*) FROM customers WHERE customer_status = 'active'
price: { priceAmount: 10, priceCurrency: USD, priceUnit: per TB scanned }
`;

it('reads what a contract promises, on what terms, and for agents', () => {
  const c = readOdcs(CUSTOMERS);
  expect(c).toMatchObject({
    id: 'customers',
    version: '1.0.0',
    status: 'active',
    team: 'customer-data',
    terms: { purpose: 'Provides customer master data for analytics and reporting' },
    slas: [
      { property: 'retention', promise: '5 year', element: undefined },
      { property: 'freshness', promise: '24 hours', element: 'customers.last_updated_at' },
    ],
    ai: {
      instructions: 'Annual premiums are stored in cents.',
      constraints: ['Do not use this data to price a policy.'],
      verifiedStatements: [
        {
          question: 'How many active customers do we have?',
          answer: "SELECT COUNT(*) FROM customers WHERE customer_status = 'active'",
        },
      ],
    },
    price: '10 USD per TB scanned',
  });
  expect(c.objects[0]).toMatchObject({ name: 'customers', rules: 2 });
  expect(c.objects[0]!.columns[1]).toMatchObject({
    name: 'customer_name',
    required: true,
    classification: 'restricted',
  });
});

it('refuses a file that is not a data contract', () => {
  expect(() => readOdcs('kind: DataProduct\nid: x\n')).toThrow('not an ODCS data contract');
});

it('names the results file beside a contract', () => {
  expect(trackRecordFile('datacontracts/customers_v1.odcs.yaml')).toBe(
    'datacontracts/customers_v1.results.ndjson',
  );
});

const V1 = { id: 'customers', version: '1.0.0' };

const promise = {
  ...V1,
  objects: ['customers', 'policies'].map((name) => ({ name, columns: [], rules: 0 })),
  slas: [{ property: 'freshness', promise: '24 hours', element: 'customers.last_updated_at' }],
};

it('counts a track record by run, the last 30, unknown as not kept', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
  const lines: Array<string> = [];

  for (let n = 0; n < 32; n++) {
    const freshness = n === 20 ? 'breached' : n === 25 ? 'unknown' : 'kept';
    lines.push(
      JSON.stringify({
        at: day(n),
        contract: V1,
        object: 'customers',
        status:
          freshness === 'kept' ? 'passed' : freshness === 'breached' ? 'failed' : 'incomplete',
        sla: [
          { property: 'freshness', element: 'customers.last_updated_at', status: freshness },
          { property: 'latency', element: 'customers.x', status: 'not-executable' },
        ],
      }),
    );
    // A second object in the same run.
    lines.push(
      JSON.stringify({ at: day(n), contract: V1, object: 'policies', status: 'passed', sla: [] }),
    );
  }

  lines.push('not json', JSON.stringify({ at: 'yesterday', status: 'passed' }));
  const record = readTrackRecord(lines.join('\n'), promise);
  expect(record).toEqual({
    runs: 30,
    passed: 28,
    last: { at: day(31), status: 'passed' },
    slas: [{ property: 'freshness', element: 'customers.last_updated_at', kept: 28, measured: 30 }],
    unreadable: 2,
  });
});

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-odcs-'));
});

afterEach(() => fs.rm(root, { recursive: true, force: true }));

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

it('reads an output’s ODCS contract and track record, and an input’s expectation', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', CUSTOMERS);
  await write(
    'crm/datacontracts/customers_v1.results.ndjson',
    `${JSON.stringify({
      at: '2026-11-19T06:00:00Z',
      contract: V1,
      object: 'customers',
      status: 'passed',
      sla: [
        { property: 'retention', status: 'kept' },
        { property: 'freshness', element: 'customers.last_updated_at', status: 'kept' },
      ],
    })}\n`,
  );
  await write(
    'crm/data-products/customers.md',
    '---\nname: Customers\noutputs:\n  - { ref: data-product/cross-sell, contract: datacontracts/customers_v1.odcs.yaml }\n---\n',
  );
  await write(
    'analytics/expectations/cross-sell.odcs.yaml',
    CUSTOMERS.replace('id: customers', 'id: cross-sell-inputs'),
  );
  await write(
    'analytics/data-products/cross-sell.md',
    '---\nname: Cross-sell\ninputs:\n  - { ref: data-product/customers, contract: expectations/cross-sell.odcs.yaml }\n---\n',
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([]);
  const customers = model.dataProducts.find((p) => p.id === 'customers')!;
  expect(customers.outputs[0]).toMatchObject({
    contract: 'datacontracts/customers_v1.odcs.yaml',
    odcs: { id: 'customers', version: '1.0.0' },
    trackRecord: { runs: 1, passed: 1 },
  });
  const crossSell = model.dataProducts.find((p) => p.id === 'cross-sell')!;
  expect(crossSell.inputs[0]).toMatchObject({ odcs: { id: 'cross-sell-inputs' } });
  expect(crossSell.inputs[0]!.trackRecord).toBeUndefined();
});

it('fails a data product whose ODCS contract does not read', async () => {
  await write('crm/datacontracts/bad.odcs.yaml', 'kind: Nope\n');
  await write(
    'crm/data-products/customers.md',
    '---\nname: Customers\noutputs:\n  - { ref: data-product/customers2, contract: datacontracts/bad.odcs.yaml }\n---\n',
  );
  await write(
    'crm/data-products/customers2.md',
    '---\nname: C2\ninputs: [data-product/customers]\n---\n',
  );

  const model = readDomainModel([{ repository: 'crm', dir: path.join(root, 'crm') }], {
    resources: [],
  });

  expect(model.failures[0]).toContain('crm/data-products/customers.md: not an ODCS data contract');
});

it('credits only this version, only what it promises, and only runs that checked every object', () => {
  interface ResultLine {
    contract: { id: string; version: string };
    object: string;
    status: string;
    sla: Array<{ property: string; element?: string; status: string }>;
  }

  const line = (r: ResultLine) => JSON.stringify({ at: '2026-11-19T06:00:00Z', ...r });
  const kept48 = [{ property: 'freshness', element: 'customers.last_updated_at', status: 'kept' }];

  const record = readTrackRecord(
    [
      // v0.9 kept a 48-hour promise: not this contract's record.
      line({
        contract: { id: 'customers', version: '0.9.0' },
        object: 'customers',
        status: 'passed',
        sla: kept48,
      }),
      line({
        contract: { id: 'orders', version: '1.0.0' },
        object: 'policies',
        status: 'passed',
        sla: [],
      }),
      // This version checked customers only.
      line({
        contract: V1,
        object: 'customers',
        status: 'passed',
        sla: [{ property: 'latency', status: 'kept' }],
      }),
    ].join('\n'),
    promise,
  );

  expect(record).toMatchObject({ runs: 1, passed: 0, last: { status: 'incomplete' }, slas: [] });
});

it('refuses a contract with no apiVersion, or a schema that does not read', () => {
  expect(() => readOdcs(CUSTOMERS.replace('apiVersion: v3.2.0', ''))).toThrow('apiVersion');
  expect(() =>
    readOdcs(
      CUSTOMERS.replace(
        /schema:[\s\S]*?slaProperties:/,
        'schema:\n  - physicalType: table\nslaProperties:',
      ),
    ),
  ).toThrow('schema.0.name');
});

it('keeps the contract as written for agents: servers, relationships, every rule', () => {
  const c = readOdcs(
    `${CUSTOMERS}servers:\n  - { server: events, type: kafka, host: broker:9092, format: avro }\n  - { server: warehouse, type: snowflake, database: CRM, schema: PUBLIC }\n`,
  );

  expect(c.document.servers).toEqual([
    { server: 'events', type: 'kafka', host: 'broker:9092', format: 'avro' },
    { server: 'warehouse', type: 'snowflake', database: 'CRM', schema: 'PUBLIC' },
  ]);
  expect(JSON.stringify(c.document.schema)).toContain('mustBeGreaterThan');
});

const contractFile = (id: string, version: string) =>
  CUSTOMERS.replace('id: customers', `id: ${id}`).replace('version: 1.0.0', `version: ${version}`);

it('reads an ODPS product whose ports name contracts by id and version, v1 beside v2', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write('crm/datacontracts/customers_v2.odcs.yaml', contractFile('c-1', '2.0.0'));
  await write(
    'crm/data-products/customers.odps.yaml',
    `apiVersion: v1.1.0
kind: DataProduct
id: fbe8d147-28db-4f1d-bedf-a3fe9f458427
name: Customer Data Product
status: active
description: { purpose: Enterprise view of a customer. }
outputPorts:
  - { name: customers, version: 1.0.0, contractId: c-1 }
  - { name: customers, version: 2.0.0, contractId: c-1 }
`,
  );
  await write(
    'analytics/data-products/cross-sell.odps.yaml',
    `apiVersion: v1.1.0
kind: DataProduct
id: cross-sell
status: active
inputPorts:
  - { name: customers, version: 1.0.0, contractId: c-1 }
`,
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([]);
  const customers = model.dataProducts.find((p) => p.id === 'customers')!;
  expect(customers).toMatchObject({
    name: 'Customer Data Product',
    summary: 'Enterprise view of a customer.',
  });
  expect(customers.outputs.map((o) => [o.reference, o.contract, o.odcs?.version])).toEqual([
    ['contract/c-1@1.0.0', 'datacontracts/customers_v1.odcs.yaml', '1.0.0'],
    ['contract/c-1@2.0.0', 'datacontracts/customers_v2.odcs.yaml', '2.0.0'],
  ]);
  const crossSell = model.dataProducts.find((p) => p.id === 'cross-sell')!;
  expect(crossSell.inputs[0]).toMatchObject({
    reference: 'data-product/customers',
    contract: 'datacontracts/customers_v1.odcs.yaml',
    contractRepository: 'crm',
    odcs: { version: '1.0.0' },
  });
});

it('fails an ODPS output that names a contract the repository does not keep', async () => {
  await write(
    'crm/data-products/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\nstatus: active\noutputPorts:\n  - { name: customers, version: 1.0.0, contractId: missing }\n',
  );

  const model = readDomainModel([{ repository: 'crm', dir: path.join(root, 'crm') }], {
    resources: [],
  });

  expect(model.failures[0]).toContain(
    "crm/data-products/customers.odps.yaml: output port 'customers' names contract missing 1.0.0",
  );
});

it('resolves a pinned version exactly, never another of its major', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write(
    'crm/data-products/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\nstatus: active\noutputPorts:\n  - { name: customers, version: 1.5.0, contractId: c-1 }\n',
  );

  const model = readDomainModel([{ repository: 'crm', dir: path.join(root, 'crm') }], {
    resources: [],
  });

  expect(model.failures[0]).toContain("output port 'customers' names contract c-1 1.5.0");
});

it('reads a root-level product whose ports give only a name, or no version', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write('crm/datacontracts/customers_v2.odcs.yaml', contractFile('c-1', '2.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\nstatus: active\ninputPorts:\n  - { name: payments }\noutputPorts:\n  - { name: customers, contractId: c-1 }\n',
  );

  const model = readDomainModel([{ repository: 'crm', dir: path.join(root, 'crm') }], {
    resources: [],
  });

  expect(model.failures).toEqual([]);
  expect(model.dataProducts[0]).toMatchObject({
    id: 'customers',
    file: 'customers.odps.yaml',
    inputs: [{ reference: 'port/payments', name: 'payments' }],
    outputs: [{ reference: 'contract/c-1', odcs: { version: '2.0.0' } }],
  });
});

it('counts a run whose promise could not be measured as incomplete', () => {
  const record = readTrackRecord(
    ['customers', 'policies']
      .map((object) =>
        JSON.stringify({
          at: '2026-11-19T06:00:00Z',
          contract: V1,
          object,
          status: 'passed',
          sla: [
            {
              property: 'freshness',
              element: 'customers.last_updated_at',
              status: 'not-executable',
            },
          ],
        }),
      )
      .join('\n'),
    promise,
  );

  expect(record).toMatchObject({ runs: 1, passed: 0, last: { status: 'incomplete' } });
});

it('reads a contract and a product that leave status out, as both standards allow', async () => {
  expect(readOdcs(CUSTOMERS.replace('status: active\n', '')).status).toBeUndefined();

  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\noutputPorts:\n  - { name: customers, version: 1.0.0, contractId: c-1 }\n',
  );

  const model = readDomainModel([{ repository: 'crm', dir: path.join(root, 'crm') }], {
    resources: [],
  });

  expect(model.failures).toEqual([]);
  expect(model.dataProducts.map((p) => p.id)).toEqual(['customers']);
});

it('reads a plain-string context as the instructions', () => {
  const c = readOdcs(
    CUSTOMERS.replace(/context:[\s\S]*?price:/, 'context: Amounts are in cents.\nprice:'),
  );

  expect(c.ai).toEqual({
    instructions: 'Amounts are in cents.',
    constraints: [],
    verifiedStatements: [],
  });
});

it('counts a run with a quality rule left unrun as incomplete', () => {
  const line = (object: string) =>
    JSON.stringify({
      at: '2026-11-19T06:00:00Z',
      contract: V1,
      object,
      status: 'passed',
      quality: [{ status: 'not-executable' }],
      sla: [{ property: 'freshness', element: 'customers.last_updated_at', status: 'kept' }],
    });

  expect(readTrackRecord([line('customers'), line('policies')].join('\n'), promise)).toMatchObject({
    passed: 0,
    last: { status: 'incomplete' },
  });
});

it('reads an unversioned input as the newest published version, not a draft file', async () => {
  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write('crm/datacontracts/customers_v2.odcs.yaml', contractFile('c-1', '2.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\noutputPorts:\n  - { name: customers, version: 1.0.0, contractId: c-1 }\n',
  );
  await write(
    'analytics/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: y\ninputPorts:\n  - { name: customers, contractId: c-1 }\n',
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([]);
  expect(model.dataProducts.find((p) => p.id === 'cross-sell')!.inputs[0]).toMatchObject({
    reference: 'data-product/customers',
    contract: 'datacontracts/customers_v1.odcs.yaml',
    odcs: { version: '1.0.0' },
  });
});

it('ranks a release above its release candidate', async () => {
  await write('crm/datacontracts/customers_rc.odcs.yaml', contractFile('c-1', '1.0.0-rc.1'));
  await write('crm/datacontracts/customers_v1.odcs.yaml', contractFile('c-1', '1.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\noutputPorts:\n  - { name: rc, version: 1.0.0-rc.1, contractId: c-1 }\n  - { name: stable, contractId: c-1 }\n',
  );
  await write(
    'analytics/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: y\ninputPorts:\n  - { name: customers, contractId: c-1 }\n',
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([]);
  expect(model.dataProducts.find((p) => p.id === 'customers')!.outputs[1]!.odcs?.version).toBe(
    '1.0.0',
  );
  expect(model.dataProducts.find((p) => p.id === 'cross-sell')!.inputs[0]!.odcs?.version).toBe(
    '1.0.0',
  );
});

it('resolves an unversioned input whose contract id holds an @', async () => {
  await write('crm/datacontracts/data.odcs.yaml', contractFile('data@team', '1.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\noutputPorts:\n  - { name: data, contractId: data@team }\n',
  );
  await write(
    'analytics/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: y\ninputPorts:\n  - { name: data, contractId: data@team }\n',
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([]);
  expect(model.dataProducts.find((p) => p.id === 'cross-sell')!.inputs[0]).toMatchObject({
    reference: 'data-product/customers',
    odcs: { id: 'data@team' },
  });
});

it('fails a pinned input no data product publishes, unless the check defers', async () => {
  await write('crm/datacontracts/data.odcs.yaml', contractFile('dataset', '1.0.0'));
  await write(
    'analytics/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: y\ninputPorts:\n  - { name: data, version: 1.0.0, contractId: dataset }\n',
  );

  const repositories = [
    { repository: 'crm', dir: path.join(root, 'crm') },
    { repository: 'analytics', dir: path.join(root, 'analytics') },
  ];

  expect(readDomainModel(repositories, { resources: [] }).failures).toEqual([
    "analytics/cross-sell.odps.yaml: input port 'data' reads contract dataset 1.0.0, which no data product publishes",
  ]);
  expect(readDomainModel(repositories, { resources: [] }, { deferMissing: true }).failures).toEqual(
    [],
  );
});

it('resolves an input to the newest version a valid product publishes, past one that fails', async () => {
  await write('crm/datacontracts/data_v1.odcs.yaml', contractFile('data', '1.0.0'));
  await write('crm/datacontracts/data_v2.odcs.yaml', contractFile('data', '2.0.0'));
  await write('crm/datacontracts/feed.odcs.yaml', contractFile('feed', '1.0.0'));
  await write(
    'crm/customers.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: x\noutputPorts:\n  - { name: data, version: 1.0.0, contractId: data }\n',
  );
  await write(
    'crm/customers-next.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: z\ninputPorts:\n  - { name: raw, contractId: feed }\noutputPorts:\n  - { name: data, version: 2.0.0, contractId: data }\n',
  );
  await write(
    'analytics/cross-sell.odps.yaml',
    'apiVersion: v1.1.0\nkind: DataProduct\nid: y\ninputPorts:\n  - { name: data, contractId: data }\n',
  );

  const model = readDomainModel(
    [
      { repository: 'crm', dir: path.join(root, 'crm') },
      { repository: 'analytics', dir: path.join(root, 'analytics') },
    ],
    { resources: [] },
  );

  expect(model.failures).toEqual([
    "crm/customers-next.odps.yaml: input port 'raw' reads contract feed, which no data product publishes",
  ]);
  expect(model.dataProducts.find((p) => p.id === 'cross-sell')!.inputs[0]).toMatchObject({
    reference: 'data-product/customers',
    odcs: { version: '1.0.0' },
  });
});
