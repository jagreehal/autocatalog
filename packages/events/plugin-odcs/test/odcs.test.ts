import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanModelResources } from 'autocatalog-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findContracts, runFromOdcs } from '../src/index';

const contract = (version = '1.0.0', nameColumn = 'customer_name', extra = '') => `
apiVersion: v3.2.0
kind: DataContract
id: customers
version: '${version}'
status: active
${extra}
schema:
  - name: customers
    physicalType: table
    properties:
      - name: customer_id
        logicalType: string
        primaryKey: true
      - name: ${nameColumn}
        logicalType: string
        required: true
      - name: customer_status
        logicalType: string
        quality:
          - metric: invalidValues
            arguments: { validValues: [active, lapsed, cancelled] }
            mustBe: 0
  - name: customer_events
    physicalType: topic
`;

let root: string;

let log: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'odcs-'));
  await fs.mkdir(path.join(root, 'datacontracts'));
  await fs.mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
  await fs.writeFile(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'), contract());
  await fs.writeFile(path.join(root, 'node_modules', 'x', 'skip.odcs.yaml'), 'not: read');
  log = [];

  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void log.push(args.join(' ')));
});

afterEach(() => vi.restoreAllMocks());

const models = async () =>
  JSON.parse(await fs.readFile(path.join(root, '.autocatalog', 'models.json'), 'utf8'));

describe('ac from-odcs', () => {
  it('finds contracts, never in node_modules', async () => {
    expect((await findContracts([root])).map((f) => path.relative(root, f))).toEqual([
      'datacontracts/customers_v1.odcs.yaml',
    ]);
  });

  it('writes each table a contract declares, keeping other exporters’ models', async () => {
    await fs.mkdir(path.join(root, '.autocatalog'));

    const prisma = {
      kind: 'table',
      id: 'orders',
      datastore: 'main',
      database: 'shop',
      adapter: 'prisma',
      schema: { type: 'object' },
    };

    await fs.writeFile(path.join(root, '.autocatalog', 'models.json'), JSON.stringify([prisma]));
    await fs.writeFile(
      path.join(root, '.autocatalog', 'config.json'),
      JSON.stringify({ datastore: 'main', database: 'shop' }),
    );

    expect(await runFromOdcs({ root })).toBe(0);
    const written = await models();
    expect(written.map((m: { id: string; adapter: string }) => `${m.adapter}:${m.id}`)).toEqual([
      'prisma:orders',
      'odcs:customers', // the topic is not a table
    ]);
    const customers = written[1];
    expect(customers).toMatchObject({
      datastore: 'main',
      database: 'shop',
      symbol: 'customers@1.0.0#customers',
    });
    expect(customers.schema.required).toEqual(['customer_id', 'customer_name']);
    expect(customers.schema.properties.customer_status['x-odcs-quality']).toBeDefined();

    // The scan publishes it as a table resource, with the contract's schema.
    const { graph, errors } = await scanModelResources({
      root,
      datastore: 'main',
      database: 'shop',
    });

    expect(errors).toEqual([]);
    const table = graph.resources.find((r) => r.ref.id === 'customers');
    expect(table?.ref).toMatchObject({ kind: 'table', namespace: 'main/shop' });
  });

  it('--check fails when the contracts moved on and the models did not', async () => {
    expect(await runFromOdcs({ root })).toBe(0);
    expect(await runFromOdcs({ root, check: true })).toBe(0);
    await fs.writeFile(
      path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'),
      contract('1.1.0').replace('required: true', 'required: false'),
    );
    expect(await runFromOdcs({ root, check: true })).toBe(1);
    expect(log.join('\n')).toContain('does not match the contracts');
  });

  const baseWith = async (files: Record<string, string>) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'odcs-base-'));
    await fs.mkdir(path.join(base, 'datacontracts'));

    for (const [file, text] of Object.entries(files))
      await fs.writeFile(path.join(base, 'datacontracts', file), text);

    return base;
  };

  const schemaOn = (schema: string) =>
    `servers: [{ server: warehouse, type: postgres, schema: ${schema} }]`;

  it('--base fails a breaking change under a minor bump', async () => {
    const base = await baseWith({ 'customers_v1.odcs.yaml': contract() });
    await fs.writeFile(
      path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'),
      contract('1.1.0', 'full_name'),
    );
    expect(await runFromOdcs({ root, base })).toBe(1);
    expect(log.join('\n')).toContain('customers.customer_name: property removed');
  });

  it('--base passes v2 beside v1, each table in its own schema', async () => {
    const v1 = contract('1.0.0', 'customer_name', schemaOn('crm_v1'));
    const base = await baseWith({ 'customers_v1.odcs.yaml': v1 });
    await fs.writeFile(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'), v1);
    await fs.writeFile(
      path.join(root, 'datacontracts', 'customers_v2.odcs.yaml'),
      contract('2.0.0', 'full_name', schemaOn('crm_v2')),
    );
    expect(await runFromOdcs({ root, base })).toBe(0);
    expect(log.join('\n')).toContain('customers@2, new contract');
    expect((await models()).map((m: { id: string }) => m.id)).toEqual([
      'crm_v1.customers',
      'crm_v2.customers',
    ]);
  });

  it('--base compares a renamed contract by id and major, wherever its file is', async () => {
    const base = await baseWith({ 'customers_v1.odcs.yaml': contract() });
    await fs.rm(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'));
    await fs.mkdir(path.join(root, 'contracts'));
    await fs.writeFile(
      path.join(root, 'contracts', 'customers_v1.odcs.yaml'),
      contract('1.1.0', 'full_name'),
    );
    expect(await runFromOdcs({ root, base })).toBe(1);
    expect(log.join('\n')).toContain(
      'datacontracts/customers_v1.odcs.yaml → contracts/customers_v1.odcs.yaml',
    );
    expect(log.join('\n')).toContain('customers.customer_name: property removed');
  });

  it('--base fails a contract removed before it was retired', async () => {
    const base = await baseWith({ 'customers_v1.odcs.yaml': contract() });
    await fs.writeFile(
      path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'),
      contract('2.0.0', 'full_name'),
    );
    expect(await runFromOdcs({ root, base })).toBe(1);
    expect(log.join('\n')).toContain('customers@1 is gone');

    const retired = await baseWith({
      'customers_v1.odcs.yaml': contract().replace('status: active', 'status: retired'),
    });

    log.length = 0;
    expect(await runFromOdcs({ root, base: retired })).toBe(0);
    expect(log.join('\n')).toContain('customers@1 removed after it was retired');
  });

  it('--base fails when the base checkout is not there', async () => {
    expect(await runFromOdcs({ root, base: path.join(root, 'no-such-base') })).toBe(1);
    expect(log.join('\n')).toContain('is not a checkout');
  });

  it('--base finds a selected, renamed contract by identity across the whole base', async () => {
    const base = await baseWith({ 'customers_v1.odcs.yaml': contract() });

    await fs.rm(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'));
    await fs.writeFile(
      path.join(root, 'datacontracts', 'people_v1.odcs.yaml'),
      contract('1.1.0', 'full_name'),
    );

    expect(
      await runFromOdcs({ root, base, contracts: ['datacontracts/people_v1.odcs.yaml'] }),
    ).toBe(1);
    expect(log.join('\n')).toContain('customers.customer_name: property removed');
  });

  it('removing the last contract clears its tables once it was retired, and fails before', async () => {
    expect(await runFromOdcs({ root })).toBe(0);
    await fs.rm(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'));

    const active = await baseWith({ 'customers_v1.odcs.yaml': contract() });

    expect(await runFromOdcs({ root, base: active })).toBe(1);

    const retired = await baseWith({
      'customers_v1.odcs.yaml': contract().replace('status: active', 'status: retired'),
    });

    expect(await runFromOdcs({ root, base: retired })).toBe(0);
    expect(await models()).toEqual([]);
  });

  it('exporting one contract keeps the other contracts’ models', async () => {
    await fs.writeFile(
      path.join(root, 'datacontracts', 'orders_v1.odcs.yaml'),
      contract()
        .replace('id: customers', 'id: orders')
        .replace(/name: customers\n/g, 'name: orders\n'),
    );
    expect(await runFromOdcs({ root })).toBe(0);
    const both = await models();

    expect(both.map((m: { id: string }) => m.id)).toEqual(['customers', 'orders']);

    const one = ['datacontracts/customers_v1.odcs.yaml'];

    expect(await runFromOdcs({ root, contracts: one })).toBe(0);
    expect((await models()).map((m: { id: string }) => m.id).sort()).toEqual([
      'customers',
      'orders',
    ]);
    expect(await runFromOdcs({ root, contracts: one, check: true })).toBe(0);
  });

  const withOrders = () =>
    fs.writeFile(
      path.join(root, 'datacontracts', 'orders_v1.odcs.yaml'),
      contract()
        .replace('id: customers', 'id: orders')
        .replace(/name: customers\n/g, 'name: orders\n'),
    );

  it('a scoped export fails on a contract another file in the repository also declares', async () => {
    expect(await runFromOdcs({ root })).toBe(0);
    const before = await models();

    await fs.writeFile(
      path.join(root, 'datacontracts', 'copy.odcs.yaml'),
      contract().replace(/name: customers\n/g, 'name: clients\n'),
    );
    log.length = 0;

    expect(await runFromOdcs({ root, contracts: ['datacontracts/copy.odcs.yaml'] })).toBe(1);
    expect(log.join('\n')).toContain(
      'datacontracts/customers_v1.odcs.yaml: customers@1 is also declared in datacontracts/copy.odcs.yaml',
    );
    expect(await models()).toEqual(before);
  });

  it('a scoped --check passes straight after a full export', async () => {
    await withOrders();
    expect(await runFromOdcs({ root })).toBe(0);
    expect(
      await runFromOdcs({ root, contracts: ['datacontracts/customers_v1.odcs.yaml'], check: true }),
    ).toBe(0);
  });

  it('a scoped run with --base drops the tables of a contract retired and removed there', async () => {
    await withOrders();
    expect(await runFromOdcs({ root })).toBe(0);

    const base = await baseWith({
      'customers_v1.odcs.yaml': contract(),
      'orders_v1.odcs.yaml': contract()
        .replace('id: customers', 'id: orders')
        .replace(/name: customers\n/g, 'name: orders\n')
        .replace('status: active', 'status: retired'),
    });

    await fs.rm(path.join(root, 'datacontracts', 'orders_v1.odcs.yaml'));
    expect(await runFromOdcs({ root, base, contracts: ['datacontracts'] })).toBe(0);
    expect((await models()).map((m: { id: string }) => m.id)).toEqual(['customers']);
  });

  it('--base fails on a base contract that does not read, or one identity declared twice', async () => {
    const broken = await baseWith({
      'customers_v1.odcs.yaml': contract(),
      'other.odcs.yaml': 'kind: Nope\n',
    });

    expect(await runFromOdcs({ root, base: broken })).toBe(1);
    expect(log.join('\n')).toContain('base datacontracts/other.odcs.yaml does not read as ODCS');

    const twice = await baseWith({
      'customers_v1.odcs.yaml': contract(),
      'customers_copy.odcs.yaml': contract(),
    });

    log.length = 0;
    expect(await runFromOdcs({ root, base: twice })).toBe(1);
    expect(log.join('\n')).toContain('customers@1 is also declared in');
  });

  it('a scoped --base fails when two base files declare the contract it checks', async () => {
    const base = await baseWith({
      'customers_v1.odcs.yaml': contract(),
      'customers_old.odcs.yaml': contract('1.0.0', 'full_name'),
    });

    await fs.rm(path.join(root, 'datacontracts', 'customers_v1.odcs.yaml'));
    await fs.mkdir(path.join(root, 'moved'));
    await fs.writeFile(path.join(root, 'moved', 'customers_v1.odcs.yaml'), contract());

    expect(await runFromOdcs({ root, base, contracts: ['moved'] })).toBe(1);
    expect(log.join('\n')).toContain('customers@1 is also declared in');
  });

  it('a failed run leaves the last good models as they were', async () => {
    expect(await runFromOdcs({ root })).toBe(0);
    const good = await models();
    await fs.writeFile(path.join(root, 'datacontracts', 'broken.odcs.yaml'), 'kind: Nope\n');
    expect(await runFromOdcs({ root })).toBe(1);
    expect(await models()).toEqual(good);
    expect(log.join('\n')).toContain('left as it was');
  });

  it('fails on a contract that is not valid ODCS, and on a table declared twice', async () => {
    await fs.writeFile(path.join(root, 'datacontracts', 'broken.odcs.yaml'), 'kind: Nope\n');
    expect(await runFromOdcs({ root })).toBe(1);
    await fs.rm(path.join(root, 'datacontracts', 'broken.odcs.yaml'));
    await fs.writeFile(
      path.join(root, 'datacontracts', 'customers_copy.odcs.yaml'),
      contract().replace('id: customers', 'id: customers_copy'),
    );
    expect(await runFromOdcs({ root })).toBe(1);
    expect(log.join('\n')).toContain('table customers is also declared in');
  });

  it('fails when there is nothing to read', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'odcs-empty-'));
    expect(await runFromOdcs({ root: empty })).toBe(1);
  });
});
