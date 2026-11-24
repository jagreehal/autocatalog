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
import { serviceClaims } from '../src/service-owners';
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

const traced = (operations: Array<string>): CatalogRelationship => ({
  type: 'calls',
  from: { kind: 'service', id: 'billing' },
  to: { kind: 'service', id: 'customers' },
  provenance: 'observed',
  needsReview: true,
  evidence: { count: 1, sampleTraceIds: [], coverage: 'unknown', operations },
});

const withEdges = (...edges: Array<CatalogRelationship>): ResourceGraph => ({
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

  const problems: Array<string> = [];

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

  const problems: Array<string> = [];

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
    const tiered = (values: Array<string>) =>
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

it('serves a spec that names no service from the service its repository is', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-api-service-'));

  const exposers = async () => {
    const graph = await withEndpoints(
      emptyResourceGraph(),
      [{ repository: 'repo', dir }],
      () => undefined,
    );

    return graph.relationships.map(({ type, from, to }) => `${from.id} ${type} ${to.id}`);
  };

  try {
    await fs.mkdir(path.join(dir, 'contracts'));
    await fs.mkdir(path.join(dir, '.autocatalog'));
    await fs.writeFile(path.join(dir, 'contracts/api.json'), JSON.stringify(document));
    expect(await exposers()).toEqual([]);

    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'customers-app' }));
    expect(await exposers()).toEqual(['GET /customers/{id} exposedBy customers-app']);

    // Two specs: the package's name does not say which one it serves; a saved service does.
    await fs.writeFile(
      path.join(dir, 'contracts/other.json'),
      JSON.stringify({ ...document, paths: {} }),
    );
    expect(await exposers()).toEqual([]);

    await fs.writeFile(
      path.join(dir, '.autocatalog/config.json'),
      JSON.stringify({ service: 'customers' }),
    );
    expect(await exposers()).toEqual(['GET /customers/{id} exposedBy customers']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it('puts the saved service before a title, holds each to the lock, and lets it be claimed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-api-saved-'));
  const problems: Array<string> = [];

  const exposers = async (owners?: Map<string, string>) => {
    const graph = await withEndpoints(
      { ...emptyResourceGraph(), resources: [architectureService('customers')] },
      [{ repository: 'repo', dir }],
      (message) => problems.push(message),
      { owners },
    );

    return graph.relationships.map(({ to }) => to.id);
  };

  const save = (service: string) =>
    fs.writeFile(path.join(dir, '.autocatalog/config.json'), JSON.stringify({ service }));

  try {
    await fs.mkdir(path.join(dir, 'contracts'));
    await fs.mkdir(path.join(dir, '.autocatalog'));
    await fs.writeFile(path.join(dir, 'contracts/api.json'), JSON.stringify(document));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'guess' }));
    await save('customers-svc');

    expect(await exposers()).toEqual(['customers-svc']);
    expect(await serviceClaims('repo', dir)).toEqual(['customers-svc']);
    // Not pinned here, a name is passed over for the next one this repository holds.
    expect(await exposers(new Map([['customers', 'repo']]))).toEqual(['customers']);
    expect(
      await exposers(
        new Map([
          ['customers', 'other'],
          ['guess', 'repo'],
        ]),
      ),
    ).toEqual(['guess']);
    expect(await exposers(new Map([['guess', 'other']]))).toEqual([]);
    expect(problems).toEqual([]);

    await save('Customers Service');
    expect(await exposers()).toEqual(['customers']);
    expect(problems).toEqual([
      expect.stringMatching(/^repo: \.autocatalog\/config\.json: service .* is not a service name/),
    ]);

    problems.length = 0;
    await fs.writeFile(path.join(dir, '.autocatalog/config.json'), '{');
    await exposers();
    expect(problems).toEqual(['repo: .autocatalog/config.json: not valid JSON']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
