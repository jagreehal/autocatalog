import { expect, it } from 'vitest';
import { createEndpointGraph } from '../src/api-resources';
import { linkGateway, publicPath, writeGatewayFile, type GatewayRoute } from '../src/gateways';
import { compileRoutePattern, matchesRoutePattern } from '../src/route-pattern';

const route = (fields: Partial<GatewayRoute>): GatewayRoute => ({
  name: 'r',
  service: 'users',
  stripPath: false,
  ...fields,
});

it.each([
  [route({ paths: ['/users'] }), '/users/{id}', '/users/{id}'],
  [route({ paths: ['/api'], stripPath: true }), '/users/{id}', '/api/users/{id}'],
  [route({ paths: ['/users'], upstreamPath: '/v1' }), '/v1/users', '/users'],
  [route({ patterns: ['/users/[^/]+$'] }), '/users/{id}', '/users/{id}'],
  [route({ patterns: ['/users/\\d+$'] }), '/users/{id}', '/users/{id}'],
  [route({ patterns: ['/users$'] }), '/users/{id}', undefined],
  [route({ paths: ['/orders'] }), '/users', undefined],
])('reaches an operation through a route', (gatewayRoute, servedAt, expected) => {
  expect(publicPath(gatewayRoute, servedAt)).toBe(expected);
});

const users = createEndpointGraph({
  repository: 'users',
  name: 'api',
  file: 'contracts/api.json',
  services: ['users'],
  document: {
    openapi: '3.1.0',
    info: { title: 'Users', version: '1.0.0' },
    security: [{ bearer: [] }],
    paths: {
      '/users/{id}': { get: {} },
      '/health': { get: { security: [] } },
    },
  },
});

it('exposes what a route reaches, and says where the gateway and the contract disagree', () => {
  const findings: string[] = [];

  const graph = linkGateway(
    users,
    {
      repository: 'gateway',
      file: {
        gateway: 'kong',
        routes: [
          route({ name: 'users', patterns: ['/users/[^/]+$'], auth: [] }),
          route({ name: 'billing', service: 'billing', paths: ['/billing'] }),
          route({ name: 'stale', paths: ['/accounts'], auth: ['jwt'] }),
        ],
      },
    },
    (message) => findings.push(message),
  );

  expect(graph.relationships).toMatchObject([
    {
      type: 'exposedBy',
      from: { id: 'GET /users/{id}' },
      to: { kind: 'gateway', id: 'kong' },
      attributes: { route: 'users', path: '/users/{id}' },
    },
  ]);
  expect(findings).toEqual([
    'gateway: autocatalog.gateway.json: route users authenticates nothing, and users secures GET /users/{id}',
    'gateway: autocatalog.gateway.json: route billing forwards to billing, whose API the catalog does not have',
    'gateway: autocatalog.gateway.json: route stale sends /accounts to users, which serves no operation there',
    'gateway: autocatalog.gateway.json: users GET /health is not exposed through kong',
  ]);
});

it('matches a pattern in time proportional to the path, and refuses what it cannot match', () => {
  const findings: string[] = [];

  linkGateway(
    users,
    {
      repository: 'gateway',
      file: {
        gateway: 'kong',
        routes: [route({ name: 'slow', patterns: ['/(a+)+$', '/(x)\\1', '/a|b'], auth: ['jwt'] })],
      },
    },
    (message) => findings.push(message),
  );

  expect(findings.filter((f) => f.includes('so it was not compared'))).toHaveLength(3);
  const started = performance.now();

  expect(publicPath(route({ patterns: ['/a*a*a*a*a*a*a*a*b$'] }), `/${'a'.repeat(5000)}`)).toBe(
    undefined,
  );
  expect(performance.now() - started).toBeLessThan(500);
});

it.each([
  ['/users$', '/users', true],
  ['/users$', '/users/1', false],
  ['/users', '/users/1', true],
  ['/users/[^/]+$', '/users/1', true],
  ['/users/[^/]+$', '/users/1/x', false],
  ['/v\\d+/items', '/v12/items', true],
  ['/files/.*', '/files/a/b', true],
  ['/colou?r$', '/color', true],
  ['/[a-c]x$', '/bx', true],
  ['/a\\sb$', '/a b', undefined],
  ['/[\\S]x$', '/ax', undefined],
])('matches %s against %s as a gateway would', (pattern, path, expected) => {
  const compiledPattern = compileRoutePattern(pattern);

  expect(compiledPattern && matchesRoutePattern(compiledPattern, path)).toBe(expected);
});

it('takes a route that does not say what authenticates it as unknown, never safe', () => {
  const findings: string[] = [];

  linkGateway(
    users,
    {
      repository: 'gateway',
      file: { gateway: 'kong', routes: [route({ name: 'silent', patterns: ['/users/[^/]+$'] })] },
    },
    (message) => findings.push(message),
  );

  expect(findings).toContain(
    'gateway: autocatalog.gateway.json: route silent does not say what authenticates it, and users secures GET /users/{id}',
  );
});

it('reaches an operation the service serves below its base path', () => {
  const versioned = createEndpointGraph({
    repository: 'users',
    name: 'api',
    file: 'contracts/api.json',
    services: ['users'],
    document: {
      openapi: '3.1.0',
      info: { title: 'Users', version: '1.0.0' },
      servers: [{ url: 'https://users.internal/v1' }],
      paths: { '/users': { get: {} } },
    },
  });

  const findings: string[] = [];

  const graph = linkGateway(
    versioned,
    {
      repository: 'gateway',
      file: { gateway: 'kong', routes: [route({ name: 'v1', paths: ['/v1'], auth: ['jwt'] })] },
    },
    (message) => findings.push(message),
  );

  expect(graph.relationships).toMatchObject([{ attributes: { path: '/v1/users' } }]);
  expect(findings).toEqual([]);
});

it('does not reach an operation the spec serves only below a base path from the root', () => {
  const versioned = createEndpointGraph({
    repository: 'users',
    name: 'api',
    file: 'contracts/api.json',
    services: ['users'],
    document: {
      openapi: '3.1.0',
      info: { title: 'Users', version: '1.0.0' },
      servers: [{ url: 'https://users.internal/v1' }],
      paths: { '/users': { get: {} } },
    },
  });

  const graph = linkGateway(
    versioned,
    {
      repository: 'gateway',
      file: {
        gateway: 'kong',
        routes: [route({ name: 'root', paths: ['/users'], auth: ['jwt'] })],
      },
    },
    () => undefined,
  );

  expect(graph.relationships).toEqual([]);
});

it('takes a pattern that may reach a secured operation as reaching it, for the auth check', () => {
  const findings: string[] = [];

  linkGateway(
    users,
    {
      repository: 'gateway',
      file: {
        gateway: 'kong',
        routes: [route({ name: 'ids', patterns: ['/users/u[0-9]+$'], auth: [] })],
      },
    },
    (message) => findings.push(message),
  );

  expect(findings).toContain(
    'gateway: autocatalog.gateway.json: route ids may reach users GET /users/{id}, which it secures, and authenticates nothing',
  );
});

it('refuses to write the gateway file through a link', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ac-gateway-'));

  await fsp.writeFile(nodePath.join(root, 'elsewhere.json'), 'untouched');
  await fsp.symlink(
    nodePath.join(root, 'elsewhere.json'),
    nodePath.join(root, 'autocatalog.gateway.json'),
  );

  await expect(writeGatewayFile(root, { gateway: 'kong', routes: [] })).rejects.toThrow(
    /is a link/,
  );
  expect(await fsp.readFile(nodePath.join(root, 'elsewhere.json'), 'utf8')).toBe('untouched');

  await fsp.rm(root, { recursive: true, force: true });
});
