import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { JsonValue } from 'autocatalog-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocsCatalog, type DocsCatalog } from '../src/catalog';
import {
  homePageProps,
  serviceBasis,
  servicePageProps,
  servicesPageProps,
} from '../src/page-models';
import { catalogSidebar } from '../src/sidebar';
import { ServicesPage } from '../src/ui/pages/ServicesPage';

let root: string;

let catalog: DocsCatalog;

const write = async (file: string, body: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), body);
};

const writeJson = (file: string, body: JsonValue) => write(file, JSON.stringify(body, null, 2));

const spec = (service: string, title: string, paths: string[]) => ({
  openapi: '3.1.0',
  'x-autocatalog': { service },
  info: { title, version: '1.0.0' },
  paths: Object.fromEntries(
    paths.map((route) => [route, { get: { responses: { '200': { description: 'ok' } } } }]),
  ),
});

// A monorepo whose services come only from OpenAPI specs, owned through CODEOWNERS.
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-services-page-'));

  await writeJson('package.json', { name: 'shop-services', private: true });
  await write(
    'CODEOWNERS',
    [
      '*                    @example-org/platform',
      '/services/orders-api/ @example-org/orders-team',
      '/services/users-api/  @example-org/users-team',
    ].join('\n'),
  );

  for (const [service, title, routes] of [
    ['orders-api', 'Orders API', ['/orders', '/orders/{id}']],
    ['users-api', 'Users API', ['/users/{id}']],
  ] as const) {
    await writeJson(`services/${service}/package.json`, { name: service, private: true });
    await writeJson(
      `services/${service}/contracts/openapi.json`,
      spec(service, title, [...routes]),
    );
  }

  await writeJson('services/orders-api/autocatalog.consumes.json', {
    calls: [{ service: 'orders-api', target: 'users-api', operation: 'GET /users/{id}' }],
  });

  catalog = await buildDocsCatalog(root, { includeDates: false });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('a catalog whose services come only from OpenAPI specs', () => {
  it('lists every service with its owner, its API, its endpoints and what it calls', () => {
    expect(catalog.failures).toEqual([]);

    const { services } = servicesPageProps(catalog, '/');

    expect(
      services.map(({ name, owner, apis, endpoints, calls }) => [
        name,
        owner?.team,
        apis.map(({ label }) => label),
        endpoints,
        calls.map(({ label }) => label),
      ]),
    ).toEqual([
      ['orders-api', 'example-org/orders-team', ['Orders API'], 2, ['users-api']],
      ['users-api', 'example-org/users-team', ['Users API'], 1, []],
    ]);
  });

  it('owns each service where CODEOWNERS owns its spec, and says so on its page', () => {
    expect(servicePageProps(catalog, { name: 'orders-api' }, '/').owner).toMatchObject({
      team: 'example-org/orders-team',
    });
  });

  it('says a service was read from its OpenAPI spec, not from events it does not have', () => {
    expect(serviceBasis(catalog, 'orders-api')).toEqual({
      evidence: 'from the OpenAPI specs it serves',
      description:
        'Inferred from the OpenAPI specs it serves. Nobody writes this page; change a spec and it changes.',
    });
    expect(servicePageProps(catalog, { name: 'orders-api' }, '/').basis).toBe(
      'from the OpenAPI specs it serves',
    );
  });

  it('puts the services in the sidebar though there are no events', () => {
    expect(catalogSidebar(catalog.events, catalog.apis)).toEqual([
      {
        label: 'Services',
        collapsed: false,
        items: ['orders-api', 'users-api'].map((name) => ({
          label: name,
          collapsed: true,
          items: [
            { label: 'Overview', link: `/services/${name}/` },
            { label: 'Scalar', link: `/apis/${name}/openapi/` },
          ],
        })),
      },
    ]);
  });

  it('draws a row per service that a reader can filter', () => {
    const html = renderToStaticMarkup(createElement(ServicesPage, servicesPageProps(catalog, '/')));

    expect(html).toContain('2 services, each with an owner.');
    expect(html).toContain('Calls users-api');
    expect(html).toContain('Called by orders-api');
    expect(html).toContain('href="/services/users-api/"');
    expect(html).toContain('aria-label="Filter services"');
  });
});

describe('the home page', () => {
  it('draws the architecture for readers inside, and no map of it for readers outside', () => {
    const inside = homePageProps(catalog, [], '/');

    expect(inside.map).toBeDefined();
    expect(inside.catalogHref).toBe('/catalog/');

    const outside = homePageProps(catalog, [], '/', new Map(), { outside: true });

    expect(outside.map).toBeUndefined();
    expect(outside.catalogHref).toBeUndefined();
  });
});
