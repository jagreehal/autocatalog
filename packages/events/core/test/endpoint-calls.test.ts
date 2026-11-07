import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEndpointGraph,
  linkEndpointCalls,
  withEndpoints,
  withoutCallerFields,
  withLinkedCalls,
} from '../src/api-resources';
import {
  architectureService,
  discoverTraceResources,
  emptyResourceGraph,
} from '../src/architecture';
import { consumersFromGraph, endpointConsumerKey, mergeConsumerGraph } from '../src/consumes';
import type { JsonObject } from '../src/json';
import { driftOpenApi } from '../src/openapi-drift';
import type { CatalogRelationship, ResourceGraph } from '../src/resource-graph';

const spec = (properties: JsonObject): JsonObject => ({
  openapi: '3.1.0',
  info: { title: 'Customers', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/customers/{id}': {
      get: {
        responses: {
          '200': {
            content: { 'application/json': { schema: { type: 'object', properties } } },
          },
          '404': { description: 'No such customer' },
        },
      },
    },
  },
});

const document = spec({ email: { type: 'string' }, tier: { type: 'string' } });

const published = createEndpointGraph({
  repository: 'customers',
  name: 'api',
  file: 'contracts/api.json',
  document,
  services: ['customers'],
});

const traced = (operations: string[]): CatalogRelationship => ({
  type: 'calls',
  from: { kind: 'service', id: 'billing' },
  to: { kind: 'service', id: 'customers' },
  provenance: 'observed',
  needsReview: true,
  evidence: { count: 1, sampleTraceIds: [], coverage: 'unknown', operations },
});

const withEdges = (...edges: CatalogRelationship[]): ResourceGraph => ({
  ...published,
  relationships: [...published.relationships, ...edges],
});

/** The lock's owners: each caller's own repository. */
const LOCK = {
  owners: new Map([
    ['billing', 'billing'],
    ['checkout', 'checkout'],
  ]),
};

const callers = (graph: ResourceGraph) =>
  graph.relationships.map(({ from, to, provenance }) => `${from.id} ${to.id} ${provenance}`);

it('reads the operation a server span saw onto the call between services', () => {
  const attribute = (key: string, stringValue: string) => ({ key, value: { stringValue } });

  const graph = discoverTraceResources({
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'billing')] },
        scopeSpans: [{ spans: [{ traceId: 't', spanId: 'a', kind: 3, attributes: [] }] }],
      },
      {
        resource: { attributes: [attribute('service.name', 'customers')] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 't',
                spanId: 'b',
                parentSpanId: 'a',
                kind: 2,
                attributes: [
                  attribute('http.request.method', 'get'),
                  attribute('http.route', '/customers/:id'),
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  expect(graph.relationships[0]?.evidence?.operations).toEqual(['GET /customers/:id']);
});

it.each(['GET /customers/{id}', 'GET /customers/:customerId', 'GET /v1/customers/{id}'])(
  'joins a traced %s to its endpoint',
  (operation) => {
    const { graph, unresolved } = linkEndpointCalls(withEdges(traced([operation])), []);

    expect(callers(graph)).toEqual(['billing GET /customers/{id} observed']);
    expect(unresolved).toEqual([]);
  },
);

it('leaves a route no endpoint matches as a call between services, and says so', () => {
  const { graph, unresolved } = linkEndpointCalls(withEdges(traced(['POST /customers/{id}'])), []);

  expect(graph.relationships).toEqual([]);
  expect(unresolved).toHaveLength(1);
});

it('keeps what a caller declared over what traces saw', () => {
  const { graph } = linkEndpointCalls(
    withEdges(traced(['GET /customers/{id}'])),
    [
      {
        repository: 'billing',
        calls: [
          {
            service: 'billing',
            target: 'customers',
            operation: 'GET /customers/{id}',
            fields: ['email'],
          },
        ],
      },
    ],
    LOCK,
  );

  expect(graph.relationships).toMatchObject([
    { provenance: 'declared', attributes: { fields: ['email'] } },
  ]);
});

it('takes the fields only from the repository that owns the caller', () => {
  const { graph } = linkEndpointCalls(withEdges(), [
    {
      repository: 'elsewhere',
      calls: [
        {
          service: 'billing',
          target: 'customers',
          operation: 'GET /customers/{id}',
          fields: ['email'],
        },
      ],
    },
  ]);

  expect(graph.relationships.find(({ to }) => to.kind === 'endpoint')?.attributes).toBeUndefined();
});

it('takes the lock as the only word on ownership once there is one', () => {
  const declared = [
    {
      repository: 'billing',
      calls: [
        {
          service: 'billing',
          target: 'customers',
          operation: 'GET /customers/{id}',
          fields: ['email'],
        },
      ],
    },
  ];

  const fieldsWith = (owners: Map<string, string>) =>
    linkEndpointCalls(withEdges(), declared, { owners }).graph.relationships.find(
      ({ to }) => to.kind === 'endpoint',
    )?.attributes;

  expect(fieldsWith(new Map([['billing', 'billing']]))).toEqual({ fields: ['email'] });
  expect(fieldsWith(new Map())).toBeUndefined();
  expect(fieldsWith(new Map([['billing', 'elsewhere']]))).toBeUndefined();
});

it('takes a declaration without an operation as every operation, and reports one naming none', () => {
  const { graph, unresolved } = linkEndpointCalls(published, [
    {
      repository: 'billing',
      calls: [
        { service: 'billing', target: 'customers' },
        { service: 'billing', target: 'customers', operation: 'DELETE /customers/{id}' },
      ],
    },
  ]);

  expect(callers(graph)).toEqual([
    'billing GET /customers/{id} declared',
    'billing customers declared',
  ]);
  expect(unresolved).toEqual([expect.stringContaining('DELETE /customers/{id}')]);
});

it('reads the APIs and calls of repositories that have no site', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-endpoints-'));
  const users = path.join(root, 'users');
  const orders = path.join(root, 'orders');

  await fs.mkdir(path.join(users, 'contracts'), { recursive: true });
  await fs.mkdir(orders);
  await fs.writeFile(
    path.join(users, 'contracts/api.json'),
    JSON.stringify({ ...document, 'x-autocatalog': { service: 'users-api' } }),
  );
  await fs.writeFile(
    path.join(orders, 'autocatalog.consumes.json'),
    JSON.stringify({
      calls: [
        { service: 'orders-api', target: 'users-api', operation: 'GET /customers/{id}' },
        { service: 'orders-api', target: 'users-api', operation: 'GET /nope' },
      ],
    }),
  );

  const problems: string[] = [];

  const graph = await withEndpoints(
    emptyResourceGraph(),
    [
      { repository: 'orders', dir: orders },
      { repository: 'users', dir: users },
    ],
    (message) => problems.push(message),
  );

  await fs.rm(root, { recursive: true, force: true });

  expect(graph.relationships.filter(({ type }) => type === 'calls').map(({ to }) => to.id)).toEqual(
    ['GET /customers/{id}', 'users-api'],
  );
  expect(problems).toEqual([expect.stringMatching(/^orders: .*GET \/nope/)]);
});

it('drops fields from a call that did not come through an owner-checked declaration', () => {
  const forged: CatalogRelationship = {
    type: 'calls',
    from: { kind: 'service', id: 'billing' },
    to: published.resources[0]!.ref,
    provenance: 'declared',
    needsReview: false,
    attributes: { fields: ['email'], note: 'kept' },
  };

  expect(withoutCallerFields(withEdges(forged)).relationships.at(-1)?.attributes).toEqual({
    note: 'kept',
  });
});

it('lets the owner declaration restore the fields an imported call lost', () => {
  const imported: CatalogRelationship = {
    type: 'calls',
    from: { kind: 'service', id: 'billing' },
    to: published.resources[0]!.ref,
    provenance: 'declared',
    needsReview: false,
    attributes: { fields: ['tier'] },
  };

  const graph = withoutCallerFields(withEdges(imported));

  const { graph: linked } = linkEndpointCalls(
    graph,
    [
      {
        repository: 'billing',
        calls: [
          {
            service: 'billing',
            target: 'customers',
            operation: 'GET /customers/{id}',
            fields: ['email'],
          },
        ],
      },
    ],
    LOCK,
  );

  expect(
    withLinkedCalls(graph, linked).relationships.filter(
      ({ type, to }) => type === 'calls' && to.kind === 'endpoint',
    ),
  ).toMatchObject([{ attributes: { fields: ['email'] } }]);
});

it('exposes no operation of a spec that names a service the lock pins elsewhere', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-endpoints-'));

  await fs.mkdir(path.join(root, 'contracts'));
  await fs.writeFile(
    path.join(root, 'contracts/api.json'),
    JSON.stringify({ ...document, 'x-autocatalog': { service: 'users-api' } }),
  );

  const problems: string[] = [];

  const graph = await withEndpoints(
    emptyResourceGraph(),
    [{ repository: 'impostor', dir: root }],
    (message) => problems.push(message),
    { owners: new Map([['users-api', 'users']]) },
  );

  await fs.rm(root, { recursive: true, force: true });

  expect(graph.relationships.filter(({ type }) => type === 'exposedBy')).toEqual([]);
  expect(problems).toEqual([
    expect.stringContaining('which the lock does not pin to this repository'),
  ]);
});

it('holds a service guessed from the title to the lock too', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-endpoints-'));

  await fs.mkdir(path.join(root, 'contracts'));
  await fs.writeFile(path.join(root, 'contracts/api.json'), JSON.stringify(document));

  const graph = await withEndpoints(
    {
      ...emptyResourceGraph(),
      resources: [architectureService('customers')],
    },
    [{ repository: 'impostor', dir: root }],
    () => undefined,
    { owners: new Map([['customers', 'customers']]) },
  );

  await fs.rm(root, { recursive: true, force: true });

  expect(graph.relationships.filter(({ type }) => type === 'exposedBy')).toEqual([]);
});

describe('drift', () => {
  let before: string;
  let after: string;

  const write = async (dir: string, doc: JsonObject) => {
    await fs.mkdir(path.join(dir, 'contracts'), { recursive: true });
    await fs.writeFile(path.join(dir, 'contracts/api.json'), JSON.stringify(doc));
  };

  beforeEach(async () => {
    before = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-calls-'));
    after = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-calls-'));
    await write(before, document);
  });

  afterEach(async () => {
    await Promise.all([before, after].map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  const company = () => {
    const { graph } = linkEndpointCalls(
      withEdges(traced(['GET /customers/{id}'])),
      [
        {
          repository: 'checkout',
          calls: [
            {
              service: 'checkout',
              target: 'customers',
              operation: 'GET /customers/{id}',
              fields: ['email'],
            },
          ],
        },
      ],
      LOCK,
    );

    return consumersFromGraph(mergeConsumerGraph(withEdges(), graph), { repository: 'customers' });
  };

  const consumersOf = (file: string, operation: string) =>
    company().endpoints.get(endpointConsumerKey(file, operation));

  it('names the caller a removed response field reaches, and not one that reads another', async () => {
    await write(after, spec({ email: { type: 'string' } }));

    const findings = await driftOpenApi(before, after, {
      consumersOf: (_file, operation) => consumersOf('contracts/api.json', operation),
    });

    expect(findings.find(({ kind }) => kind === 'field_removed')).toMatchObject({
      consumers: ['billing'],
      usage: { unaffected: ['checkout'] },
    });
  });

  it('names the caller a widened response enum breaks, by the field it reads', async () => {
    const tiered = (values: string[]) =>
      spec({ email: { type: 'string' }, tier: { type: 'string', enum: values } });

    await write(before, tiered(['gold']));
    await write(after, tiered(['gold', 'silver']));

    const findings = await driftOpenApi(before, after, {
      consumersOf: (_file, operation) => {
        const { graph } = linkEndpointCalls(
          withEdges(),
          [
            {
              repository: 'checkout',
              calls: [{ service: 'checkout', target: 'customers', operation, fields: ['tier'] }],
            },
            {
              repository: 'billing',
              calls: [{ service: 'billing', target: 'customers', operation, fields: ['email'] }],
            },
          ],
          LOCK,
        );

        return consumersFromGraph(mergeConsumerGraph(withEdges(), graph), {
          repository: 'customers',
        }).endpoints.get(endpointConsumerKey('contracts/api.json', operation));
      },
    });

    expect(findings.find(({ severity }) => severity === 'breaking')).toMatchObject({
      consumers: ['checkout'],
      usage: { unaffected: ['billing'] },
    });
  });

  it('names every caller of a removed operation', async () => {
    await write(after, { ...document, paths: {} });

    const findings = await driftOpenApi(before, after, {
      consumersOf: (_file, operation) => consumersOf('contracts/api.json', operation),
    });

    expect(findings.find(({ kind }) => kind === 'operation_removed')?.consumers).toEqual([
      'billing',
      'checkout',
    ]);
  });
});
