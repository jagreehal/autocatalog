import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverOpenApi, eventsFromOpenApiDocument } from '../src/scan-openapi';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-scan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const paymentPayload = {
  type: 'object',
  required: ['paymentId'],
  properties: { paymentId: { type: 'string' }, amount: { type: 'number' } },
};

const spec = {
  openapi: '3.1.0',
  info: { title: 'Payments', version: '1.0.0' },
  webhooks: {
    'payment.completed': {
      post: {
        tags: ['payments'],
        summary: 'Payment completed',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
        },
      },
    },
  },
  paths: {
    '/payments/{id}': {
      get: { operationId: 'getPayment', responses: { 200: { description: 'ok' } } },
      post: {
        operationId: 'createPayment',
        requestBody: { content: { 'application/json': { schema: paymentPayload } } },
        responses: { 202: { description: 'accepted' } },
      },
    },
  },
  components: { schemas: { Payment: paymentPayload } },
};

describe('eventsFromOpenApiDocument', () => {
  it('maps a webhook to an event and resolves its $ref payload', () => {
    const found = eventsFromOpenApiDocument(spec, 'openapi.yaml');
    expect(found).toHaveLength(1);
    expect(found[0]!.event.id).toBe('payment.completed');
    expect(found[0]!.event.domain).toBe('payments');
    expect(found[0]!.event.schema).toEqual(paymentPayload);
    expect(found[0]!.finding.kind).toBe('openapi-webhook');
  });

  it('ignores plain request/response endpoints — a REST call is not an event', () => {
    const found = eventsFromOpenApiDocument(spec, 'openapi.yaml');
    expect(found.map((f) => f.event.id)).not.toContain('create.payment');
  });

  it('includes an operation that opts in with x-autocatalog', () => {
    const route = spec.paths['/payments/{id}'];

    const optedIn = {
      ...spec,
      paths: {
        '/payments/{id}': {
          ...route,
          post: {
            ...route.post,
            'x-autocatalog': { id: 'payment.requested', version: '2.0.0', domain: 'payments' },
          },
        },
      },
    };

    const found = eventsFromOpenApiDocument(optedIn, 'openapi.yaml');
    const event = found.find((f) => f.event.id === 'payment.requested')!;
    expect(event.finding.kind).toBe('openapi-operation');
    // Declared id and version mean nothing was guessed.
    expect(event.event.version).toBe('2.0.0');
    expect(event.event.needsReview).toBe(false);
    expect(event.event.provenance?.default).toBe('extracted');
  });

  it('maps callbacks, which are events attached to an operation', () => {
    const route = spec.paths['/payments/{id}'];

    const withCallback = {
      ...spec,
      paths: {
        '/payments/{id}': {
          ...route,
          post: {
            ...route.post,
            callbacks: {
              'payment.settled': {
                '{$request.body#/callbackUrl}': {
                  post: {
                    requestBody: { content: { 'application/json': { schema: paymentPayload } } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const found = eventsFromOpenApiDocument(withCallback, 'openapi.yaml');
    const callback = found.find((f) => f.finding.kind === 'openapi-callback')!;
    expect(callback.event.id).toBe('payment.settled');
  });

  it('marks a webhook without declared metadata as needing review', () => {
    const found = eventsFromOpenApiDocument(spec, 'openapi.yaml');
    expect(found[0]!.event.needsReview).toBe(true);
    expect(found[0]!.event.provenance?.fields?.version).toBe('inferred');
  });

  it('throws a named error rather than hanging on a circular $ref', () => {
    const circular = {
      openapi: '3.1.0',
      webhooks: { loop: { post: { requestBody: { $ref: '#/components/x' } } } },
      components: { x: { $ref: '#/components/x' } },
    };

    expect(() => eventsFromOpenApiDocument(circular, 'openapi.yaml')).toThrow(/circular \$ref/);
  });
});

describe('discoverOpenApi', () => {
  // The prefilter was anchored to the start of a line, so a JSON spec emitted
  // on one line — which is how most tools write it — was skipped with no
  // candidate and no error. Silence is the worst possible answer here.
  it('finds an OpenAPI document written on a single line', async () => {
    await fs.writeFile(
      path.join(root, 'compact.json'),
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Compact', version: '1.0.0' },
        webhooks: {
          'order.placed': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { orderId: { type: 'string' } } },
                  },
                },
              },
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      }),
    );

    const result = await discoverOpenApi({ root });
    expect(result.errors).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.event.id)).toContain('order.placed');
  });

  it('finds YAML specs and skips YAML that is not OpenAPI', async () => {
    await fs.writeFile(
      path.join(root, 'openapi.yaml'),
      [
        'openapi: 3.1.0',
        'webhooks:',
        '  order.placed:',
        '    post:',
        '      tags: [orders]',
        '      requestBody:',
        '        content:',
        '          application/json:',
        '            schema:',
        '              type: object',
        '              properties:',
        '                orderId: { type: string }',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(root, 'docker-compose.yml'),
      'services:\n  web:\n    image: nginx',
    );

    const result = await discoverOpenApi({ root });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.id)).toEqual(['order.placed']);
    expect(result.events[0]!.source?.file).toBe('openapi.yaml');
    expect(result.events[0]!.domain).toBe('orders');
  });

  it('reports a malformed spec instead of failing the whole scan', async () => {
    await fs.writeFile(path.join(root, 'openapi.yaml'), 'openapi: 3.1.0\nwebhooks: [oops\n');
    const result = await discoverOpenApi({ root });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('openapi.yaml');
  });
});
