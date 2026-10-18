import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { apiOperations, servicesForApi } from '../src/apis';
import { buildDocsCatalog } from '../src/catalog';
import { schemaFormat } from '../src/schemas';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-apis-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const spec = `openapi: 3.1.0
info:
  title: Billing API
  version: 2.0.0
paths:
  /invoices:
    get:
      summary: List invoices
    post:
      operationId: createInvoice
      deprecated: true
webhooks:
  invoicePaid:
    post:
      x-autocatalog:
        id: invoice.paid
        version: 1.0.0
        domain: billing
        producers: [ledger]
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { id: { type: string } } }
`;

it('gives each OpenAPI spec a repository commits a page, and links it to the service producing its webhooks', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts/billing'), { recursive: true });
  await fs.writeFile(path.join(root, 'shop/contracts/billing/openapi.yaml'), spec);

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.apis).toMatchObject([
    { repository: 'shop', name: 'billing-openapi', file: 'contracts/billing/openapi.yaml' },
  ]);

  const [api] = catalog.apis;

  expect(apiOperations(api!)).toEqual([
    { method: 'GET', path: '/invoices', summary: 'List invoices', deprecated: false },
    { method: 'POST', path: '/invoices', summary: 'createInvoice', deprecated: true },
  ]);
  expect(servicesForApi(api!, catalog.events)).toEqual(['ledger']);
  expect(schemaFormat(catalog.events[0]!, catalog)).toBe('OpenAPI');
});

it('matches a service by the title its spec gives', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/openapi.yaml'),
    spec.replace('Billing API', 'Ledger API'),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  // No webhook names it as a producer: the title alone.
  const events = catalog.events.map((entry) => ({
    ...entry,
    event: { ...entry.event, frontmatter: { ...entry.event.frontmatter, source: undefined } },
  }));

  expect(servicesForApi(catalog.apis[0]!, events)).toEqual(['ledger']);
});

it('publishes no spec through a contracts folder that is a symlink', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

  try {
    await fs.writeFile(path.join(outside, 'openapi.yaml'), spec);
    await fs.mkdir(path.join(root, 'shop'), { recursive: true });
    await fs.symlink(outside, path.join(root, 'shop/contracts'), 'junction');

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.apis).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

it('gives specs that share a name a page each', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(path.join(root, 'shop/contracts/openapi.yaml'), spec);
  await fs.writeFile(
    path.join(root, 'shop/contracts/openapi.json'),
    JSON.stringify({ openapi: '3.1.0', info: { title: 'Shop API', version: '1.0.0' }, paths: {} }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.apis.map((api) => api.name)).toEqual(['openapi-json', 'openapi-yaml']);
});
