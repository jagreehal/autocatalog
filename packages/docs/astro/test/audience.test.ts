import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { publicApiDocument } from '../src/audience';
import { buildSiteCatalog } from '../src/catalog';
import { chatPages } from '../src/chat';
import { docsSiteConfig } from '../src/config';

const document = {
  openapi: '3.1.0',
  info: { title: 'Payments', version: '1.0.0' },
  'x-autocatalog': { service: 'payments-service' },
  tags: [{ name: 'Payments' }, { name: 'Operations' }],
  paths: {
    '/payments/{id}': {
      parameters: [{ name: 'id', in: 'path' }],
      get: {
        tags: ['Payments'],
        responses: {
          200: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
        },
      },
      delete: { tags: ['Operations'], 'x-internal': true },
    },
    '/reconcile': {
      post: {
        tags: ['Operations'],
        'x-internal': true,
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } },
        },
      },
    },
    '/admin': { 'x-internal': true, get: {} },
  },
  webhooks: {
    paid: { post: { 'x-autocatalog': { producers: ['ledger'] } } },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Payment: { properties: { amount: { $ref: '#/components/schemas/Money' } } },
      Money: { type: 'string' },
      Job: { properties: { money: { $ref: '#/components/schemas/Money' } } },
    },
  },
};

it('leaves out what is internal, and what only that used', () => {
  expect(publicApiDocument(document)).toEqual({
    openapi: '3.1.0',
    info: { title: 'Payments', version: '1.0.0' },
    tags: [{ name: 'Payments' }],
    paths: {
      '/payments/{id}': {
        parameters: [{ name: 'id', in: 'path' }],
        get: document.paths['/payments/{id}'].get,
      },
    },
    webhooks: { paid: { post: {} } },
    components: {
      securitySchemes: document.components.securitySchemes,
      schemas: { Payment: document.components.schemas.Payment, Money: { type: 'string' } },
    },
  });
});

it('publishes nothing of a document that is internal, or has nothing left', () => {
  expect(publicApiDocument({ ...document, 'x-internal': true })).toBeUndefined();
  expect(
    publicApiDocument({ openapi: '3.1.0', paths: { '/a': { get: { 'x-internal': true } } } }),
  ).toBeUndefined();
});

it('filters the path items a path names by $ref, and drops a path left naming nothing', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: {
      '/pets': { $ref: '#/components/pathItems/Pets' },
      '/admin': { $ref: '#/components/pathItems/Admin' },
      '/remote': { $ref: 'https://example.com/paths.yaml#/Remote' },
    },
    components: {
      pathItems: {
        Pets: { get: {}, delete: { 'x-internal': true } },
        Admin: { post: { 'x-internal': true } },
      },
    },
  });

  expect(published).toEqual({
    openapi: '3.1.0',
    paths: { '/pets': { $ref: '#/components/pathItems/Pets' } },
    components: { pathItems: { Pets: { get: {} } } },
  });
});

it('filters the operations beside a path item $ref', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: {
      '/pets': {
        $ref: '#/components/pathItems/Pets',
        delete: { 'x-internal': true, description: 'Private' },
      },
    },
    components: { pathItems: { Pets: { get: {} } } },
  });

  expect(published?.paths).toEqual({ '/pets': { $ref: '#/components/pathItems/Pets' } });
});

it('keeps a path whose $ref shares only parameters, beside its own operation', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: { '/pets/{id}': { $ref: '#/components/pathItems/PetId', get: {} } },
    components: { pathItems: { PetId: { parameters: [{ name: 'id', in: 'path' }] } } },
  });

  expect(published).toEqual({
    openapi: '3.1.0',
    paths: { '/pets/{id}': { $ref: '#/components/pathItems/PetId', get: {} } },
    components: { pathItems: { PetId: { parameters: [{ name: 'id', in: 'path' }] } } },
  });
  expect(
    publicApiDocument({
      openapi: '3.1.0',
      paths: { '/pets/{id}': { $ref: '#/components/pathItems/PetId' } },
      components: { pathItems: { PetId: { parameters: [] } } },
    }),
  ).toBeUndefined();
});

it('follows a chain of path item $refs, and drops a cycle', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: {
      '/pets': { $ref: '#/components/pathItems/Alias' },
      '/loop': { $ref: '#/components/pathItems/Loop' },
    },
    components: {
      pathItems: {
        Alias: { $ref: '#/components/pathItems/Pets' },
        Pets: { get: {} },
        Loop: { $ref: '#/components/pathItems/Loop' },
      },
    },
  });

  expect(published?.paths).toEqual({ '/pets': { $ref: '#/components/pathItems/Alias' } });
  expect(published?.components).toEqual({
    pathItems: { Alias: { $ref: '#/components/pathItems/Pets' }, Pets: { get: {} } },
  });
});

it('leaves out internal callbacks, inline or named', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: {
      '/orders': {
        post: {
          callbacks: {
            shipped: { '{$request.body#/url}': { post: { description: 'Public' } } },
            audited: {
              '{$request.body#/audit}': { post: { 'x-internal': true, description: 'Private' } },
            },
            settled: { $ref: '#/components/callbacks/Settled' },
          },
        },
      },
    },
    components: {
      callbacks: {
        Settled: { '{$request.body#/ledger}': { post: { 'x-internal': true } } },
      },
    },
  });

  expect(published?.paths).toEqual({
    '/orders': {
      post: {
        callbacks: { shipped: { '{$request.body#/url}': { post: { description: 'Public' } } } },
      },
    },
  });
  expect(JSON.stringify(published)).not.toContain('Private');
});

it('drops a tag only an unpublished path item used', () => {
  const published = publicApiDocument({
    openapi: '3.1.0',
    tags: [{ name: 'Pets' }, { name: 'Admin', description: 'Private' }],
    paths: {
      '/pets': { get: { tags: ['Pets'] } },
      '/admin': { 'x-internal': true, $ref: '#/components/pathItems/Admin' },
    },
    components: { pathItems: { Admin: { get: { tags: ['Admin'] } } } },
  });

  expect(published?.tags).toEqual([{ name: 'Pets' }]);
  expect(published?.components).toEqual({ pathItems: {} });
});

it('keeps the schemas a discriminator maps to', () => {
  const pet = {
    discriminator: {
      propertyName: 'kind',
      mapping: { cat: '#/components/schemas/Cat', dog: 'Dog' },
    },
  };

  const published = publicApiDocument({
    openapi: '3.1.0',
    paths: {
      '/pets': {
        get: {
          responses: {
            200: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: { Pet: pet, Cat: { type: 'object' }, Dog: { type: 'object' }, Unused: {} },
    },
  });

  expect(published?.components).toEqual({
    schemas: { Pet: pet, Cat: { type: 'object' }, Dog: { type: 'object' } },
  });
});

it('builds for an audience from their documents and the references alone', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-audience-'));

  const write = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), body);
  };

  try {
    await write('api/docs/guide.md', '---\ntitle: Guide\nowner: devrel\naudience: [public]\n---\n');
    await write('api/docs/runbook.md', '---\ntitle: Runbook\nowner: oncall\n---\n');
    await write(
      'api/contracts/openapi.json',
      JSON.stringify({
        ...document,
        paths: { '/payments/{id}': { get: document.paths['/payments/{id}'].get } },
      }),
    );

    const catalog = await buildSiteCatalog({ ...docsSiteConfig(), root, audience: 'public' });

    expect(catalog.docs.map((doc) => [doc.id, doc.data.owner])).toEqual([['api/guide', undefined]]);
    expect(catalog.manifest['api/guide']).toMatchObject({ owner: '', source: null });
    expect(catalog.apis.map((api) => api.document['x-autocatalog'])).toEqual([undefined]);
    expect([catalog.events, catalog.graph.resources]).toEqual([[], []]);

    // A quarantined repository stays named, so the pages leave it out as well.
    await write('broken/docs/meta.json', '{ "label": 123 }');
    await write('broken/docs/guide.md', '---\ntitle: Broken\nowner: x\naudience: [public]\n---\n');

    const withBroken = await buildSiteCatalog({ ...docsSiteConfig(), root, audience: 'public' });

    expect(withBroken.failures.map((failure) => failure.repository)).toEqual(['broken']);
    expect(withBroken.docs.map((doc) => doc.id)).toEqual(['api/guide']);

    // The assistant answers from the same pages, at their addresses under the base.
    const pages = chatPages(catalog, '/docs/');

    expect(pages.map((page) => page.href)).toEqual(['/docs/api/guide/', '/docs/apis/api/openapi/']);
    expect(pages[1]!.text).toContain('GET /payments/{id}');
    expect(pages.map((page) => page.text).join()).not.toMatch(/x-internal|x-autocatalog|Runbook/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
