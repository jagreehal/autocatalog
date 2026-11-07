import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { apiOperations, servicesForApi } from '../src/apis';
import { buildDocsCatalog } from '../src/catalog';
import { servicePages } from '../src/page-models';
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

it('puts each operation in the graph, exposed by the service the spec declares', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
x-autocatalog: { service: invoicing }
paths:
  /invoices/{id}:
    get:
      operationId: getInvoice
      summary: Read an invoice
`,
  );

  const { graph } = await buildDocsCatalog(root, { includeDates: false });

  const ref = { kind: 'endpoint', namespace: 'shop/billing', id: 'GET /invoices/{id}' };

  expect(graph.resources.find((resource) => resource.ref.kind === 'endpoint')).toMatchObject({
    ref,
    title: 'GET /invoices/{id}',
    summary: 'Read an invoice',
    url: 'apis/shop/billing/',
    source: { repo: 'shop', file: 'contracts/billing.yaml', symbol: 'getInvoice' },
    attributes: { method: 'GET', path: '/invoices/{id}', apiVersion: '2.0.0' },
  });
  expect(graph.relationships.filter(({ type }) => type === 'exposedBy')).toMatchObject([
    { from: ref, to: { kind: 'service', id: 'invoicing' }, provenance: 'declared' },
  ]);
  expect(
    graph.resources.some(({ ref: { kind, id } }) => kind === 'service' && id === 'invoicing'),
  ).toBe(true);
});

it('infers the service from the spec title, and says it inferred it', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.mkdir(path.join(root, 'shop/contracts/events'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/events/invoice.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'InvoiceSent',
      type: 'object',
      'x-autocatalog': {
        id: 'invoice.sent',
        version: '1.0.0',
        domain: 'billing',
        producers: ['billing'],
      },
    }),
  );
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
paths:
  /invoices:
    get:
      summary: List invoices
`,
  );

  const { graph } = await buildDocsCatalog(root, { includeDates: false });

  expect(graph.relationships.filter(({ type }) => type === 'exposedBy')).toMatchObject([
    { to: { kind: 'service', id: 'billing' }, provenance: 'inferred', needsReview: false },
  ]);
});

it('reports a path whose $ref does not resolve, and keeps the rest of the catalog', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.mkdir(path.join(root, 'shop/events'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
paths:
  /invoices:
    get: { summary: List invoices }
  /broken:
    $ref: '#/components/pathItems/missing'
`,
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.failures).toMatchObject([
    { repository: 'shop', source: 'apis', message: expect.stringContaining('/broken') },
  ]);
  expect(
    catalog.graph.resources.flatMap(({ ref }) => (ref.kind === 'endpoint' ? [ref.id] : [])),
  ).toEqual(['GET /invoices']);
  expect(apiOperations(catalog.apis[0]!).map(({ path: route }) => route)).toEqual(['/invoices']);
});

it('gives a service only a spec names a page', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
x-autocatalog: { service: invoicing }
paths: {}
`,
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(servicePages(catalog)).toEqual(new Set(['invoicing']));
});

it('refuses a declared service name that cannot be a page', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
x-autocatalog: { service: ../../etc }
paths: {}
`,
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.failures).toMatchObject([{ repository: 'shop', source: 'apis' }]);
  expect(servicePages(catalog).size).toBe(0);
});

it('gives no page to a service the lock pins to another repository', async () => {
  await fs.mkdir(path.join(root, 'shop/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'shop/contracts/billing.yaml'),
    `openapi: 3.1.0
info: { title: Billing API, version: 2.0.0 }
x-autocatalog: { service: invoicing }
paths:
  /invoices:
    get: { summary: List invoices }
`,
  );

  process.env.AUTOCATALOG_DOCS_SERVICE_OWNERS = JSON.stringify({ invoicing: 'billing' });

  try {
    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(servicePages(catalog).size).toBe(0);
    expect(catalog.graph.relationships.filter(({ type }) => type === 'exposedBy')).toEqual([]);
    expect(catalog.failures).toMatchObject([
      {
        repository: 'shop',
        source: 'apis',
        message: expect.stringContaining('does not pin to shop'),
      },
    ]);
  } finally {
    delete process.env.AUTOCATALOG_DOCS_SERVICE_OWNERS;
  }
});
