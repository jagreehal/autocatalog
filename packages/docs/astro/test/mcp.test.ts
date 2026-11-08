import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JsonObject } from 'autocatalog-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSiteCatalog, type DocsCatalog } from '../src/catalog';
import { docsSiteConfig } from '../src/config';
import { docsMcpServer, getOperation, listOperations } from '../src/mcp';

const spec = `openapi: 3.1.0
info:
  title: Payments API
  version: 1.0.0
servers:
  - url: https://api.example.com
security:
  - bearer: []
paths:
  /payments/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string }
    get:
      operationId: getPayment
      summary: Get a payment
      tags: [Payments]
      responses:
        '200':
          description: The payment.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Payment' }
    delete:
      operationId: purgePayment
      x-internal: true
      responses:
        '204': { description: Gone. }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
    unused: { type: apiKey, in: header, name: x-key }
  schemas:
    Payment:
      type: object
      properties:
        amount: { $ref: '#/components/schemas/Money' }
    Money:
      type: object
      properties:
        currency: { type: string }
`;

let root: string;

let catalog: DocsCatalog;

let client: Client;

// Every tool answers with one text block.
const toolText = z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1);

const call = async (name: string, args: Record<string, string | number> = {}) => {
  const result = await client.callTool({ name, arguments: args });

  return toolText.parse(result.content)[0]!.text;
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-'));

  const write = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), body);
  };

  await write('api/contracts/openapi.yaml', spec);
  await write(
    'api/docs/auth.md',
    '---\ntitle: Authenticating\nowner: devrel\nsummary: Send a bearer token.\naudience: [public]\n---\n\nSend your key as a bearer token.\n',
  );
  await write('api/docs/runbook.md', '---\ntitle: Runbook\nowner: oncall\n---\n\nInternal only.\n');

  catalog = await buildSiteCatalog({ ...docsSiteConfig(), root, audience: 'public' });

  const server = docsMcpServer(catalog, {
    title: 'Acme Developers',
    description: 'The Acme API.',
    origin: 'https://developers.example.com',
    base: '/',
  });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client?.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('the MCP server', () => {
  it('offers searching and reading, and the API operations when there is an API', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'search_docs',
      'list_pages',
      'read_page',
      'list_operations',
      'get_operation',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
  });

  it('finds a guide by its words, at its address on the site, and reads it whole', async () => {
    const found = await call('search_docs', { query: 'bearer token' });

    expect(found).toContain('## Authenticating\nhttps://developers.example.com/api/auth/');
    expect(found).not.toContain('Runbook');

    const page = await call('read_page', { url: 'https://developers.example.com/api/auth/' });

    expect(page).toContain('# Authenticating');
    expect(page).toContain('Send your key as a bearer token.');
    expect(await call('read_page', { url: '/api/runbook/' })).toMatch(/^No page at/);
  });

  it('lists the pages this reader may open, and one section of them', async () => {
    const all = await call('list_pages');

    expect(all).toContain(
      '- Authenticating: https://developers.example.com/api/auth/: Send a bearer token.',
    );
    expect(all).not.toContain('Runbook');
    expect(await call('list_pages', { under: '/api/auth' })).toBe(
      '- Authenticating: https://developers.example.com/api/auth/: Send a bearer token.',
    );
    expect(await call('list_pages', { under: '/nowhere/' })).toMatch(/^No pages under/);
    expect(await call('list_pages', { limit: 1 })).toMatch(/more\. Pass under/);
  });

  it('names the closest pages when a read misses', async () => {
    expect(await call('read_page', { url: '/api/authentication/' })).toContain(
      'Closest:\n- Authenticating: https://developers.example.com/api/auth/',
    );
  });

  it('tells a client where to start, and its real version', () => {
    expect(client.getInstructions()).toContain('list_pages');
    expect(client.getServerVersion()?.version).not.toBe('1.0.0');
  });

  it('lists only the operations the audience may see', async () => {
    expect(await call('list_operations')).toBe(
      'GET /payments/{id} (getPayment): Get a payment [Payments]',
    );
    expect(listOperations(catalog).map((operation) => operation.operationId)).toEqual([
      'getPayment',
    ]);
  });

  it('returns an operation with everything a request needs beside it', async () => {
    const found = JSON.parse(await call('get_operation', { operationId: 'getPayment' }));

    expect(found).toMatchObject({
      method: 'GET',
      path: '/payments/{id}',
      servers: [{ url: 'https://api.example.com' }],
      security: [{ bearer: [] }],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      pathParameters: [{ name: 'id', in: 'path' }],
    });
    // The schema it names, and the one that names: once each, and nothing it does not use.
    expect(Object.keys(found.components.schemas)).toEqual(['Payment', 'Money']);
    expect(found.securitySchemes.unused).toBeUndefined();

    expect(getOperation(catalog, { method: 'get', path: '/payments/{id}' })?.path).toBe(
      '/payments/{id}',
    );
    expect(getOperation(catalog, { operationId: 'purgePayment' })).toBeUndefined();
  });
});

describe('operations across several APIs', () => {
  const api = (repository: string, servers: JsonObject = {}) => ({
    repository,
    name: 'openapi',
    file: 'contracts/openapi.yaml',
    document: {
      openapi: '3.1.0',
      info: { title: `${repository} API`, version: '1' },
      servers: [{ url: `https://${repository}.example.com` }],
      paths: {
        '/items': {
          ...servers,
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
          post: {
            operationId: 'createItem',
            servers: [{ url: 'https://upload.example.com' }],
            responses: { '201': { description: 'made' } },
          },
        },
      },
    },
  });

  const two = { apis: [api('orders'), api('stock')] };

  it('refuses to guess between two APIs with the same operation, and takes the one named', () => {
    expect(() => getOperation(two, { operationId: 'listItems' })).toThrow(
      '2 APIs have this operation: orders/openapi, stock/openapi. Name one as api.',
    );
    expect(
      getOperation(two, { api: 'stock/openapi', method: 'GET', path: '/items' }),
    ).toMatchObject({
      apiId: 'stock/openapi',
      servers: [{ url: 'https://stock.example.com' }],
    });
  });

  it('says which API each operation belongs to', () => {
    expect(listOperations(two).map(({ apiId, operationId }) => `${apiId} ${operationId}`)).toEqual([
      'orders/openapi listItems',
      'orders/openapi createItem',
      'stock/openapi listItems',
      'stock/openapi createItem',
    ]);
  });

  it('returns the servers nearest the operation: its own, then its path’s, then the document’s', () => {
    const one = { apis: [api('orders', { servers: [{ url: 'https://items.example.com' }] })] };

    expect(getOperation(one, { operationId: 'createItem' })?.servers).toEqual([
      { url: 'https://upload.example.com' },
    ]);
    expect(getOperation(one, { operationId: 'listItems' })?.servers).toEqual([
      { url: 'https://items.example.com' },
    ]);
  });
});

describe('operations a spec reaches by $ref', () => {
  const catalog = {
    apis: [
      {
        repository: 'orders',
        name: 'openapi',
        file: 'contracts/openapi.yaml',
        document: {
          openapi: '3.1.0',
          info: { title: 'Orders API', version: '1' },
          paths: { '/orders': { $ref: '#/components/pathItems/Orders' } },
          components: {
            pathItems: {
              Orders: {
                get: {
                  operationId: 'listOrders',
                  responses: {
                    '200': {
                      description: 'ok',
                      content: {
                        'application/json': {
                          schema: { $ref: '#/components/schemas/Order~1Line' },
                        },
                      },
                    },
                  },
                },
              },
            },
            schemas: { 'Order/Line': { type: 'object' } },
          },
        },
      },
    ],
  };

  it('lists and returns an operation its path item points at, with a schema whose name is escaped', () => {
    expect(listOperations(catalog).map(({ operationId }) => operationId)).toEqual(['listOrders']);
    expect(getOperation(catalog, { operationId: 'listOrders' })?.components).toEqual({
      schemas: { 'Order/Line': { type: 'object' } },
    });
  });
});

it('reads a relative path that starts with "http" as a path', async () => {
  expect(await call('read_page', { url: 'http-caching/' })).toMatch(/^No page at http-caching\//);
});
