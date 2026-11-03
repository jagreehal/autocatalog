import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-federation-'));
});

afterEach(async () => {
  delete process.env.AUTOCATALOG_DOCS_INDEXES;
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it("resolves a reference to an event only another site's index publishes", async () => {
  const repo = path.join(root, 'checkouts', 'fulfillment');

  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  await fs.writeFile(
    path.join(repo, 'autocatalog.consumes.json'),
    JSON.stringify({ receives: [{ service: 'Warehouse Service', id: 'order-completed' }] }),
  );

  const ref = {
    kind: 'event',
    namespace: 'orders/orders',
    id: 'order-completed',
    version: '1.0.0',
  };

  const index = path.join(root, 'orders-index.json');

  await fs.writeFile(
    index,
    JSON.stringify({
      spec: 'autocatalog/graph-v1',
      resources: [
        {
          ref,
          title: 'Order Completed',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domain: 'orders', status: 'active', schema: './schema.json', examples: 0 },
        },
      ],
      relationships: [],
    }),
  );

  process.env.AUTOCATALOG_DOCS_INDEXES = index;

  const catalog = await buildDocsCatalog(path.join(root, 'checkouts'), { includeDates: false });

  expect(catalog.graph.relationships).toContainEqual(
    expect.objectContaining({
      type: 'consumes',
      from: ref,
      to: { kind: 'service', id: 'Warehouse Service' },
    }),
  );
  expect(catalog.warnings.join('\n')).not.toMatch(/order-completed, which no repository publishes/);
});

it('resolves references between repositories with no index at all', async () => {
  const orders = path.join(root, 'checkouts', 'orders');
  const fulfillment = path.join(root, 'checkouts', 'fulfillment');

  await fs.mkdir(path.join(orders, '.git'), { recursive: true });
  await fs.mkdir(path.join(orders, 'contracts/events'), { recursive: true });
  await fs.writeFile(
    path.join(orders, 'contracts/events/order.completed.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'OrderCompleted',
      type: 'object',
      properties: { orderId: { type: 'string' } },
      'x-autocatalog': { id: 'order-completed', version: '1.0.0', domain: 'orders' },
    }),
  );

  await fs.mkdir(path.join(fulfillment, '.git'), { recursive: true });
  await fs.writeFile(
    path.join(fulfillment, 'autocatalog.consumes.json'),
    JSON.stringify({ receives: [{ service: 'Warehouse Service', id: 'order-completed' }] }),
  );

  const catalog = await buildDocsCatalog(path.join(root, 'checkouts'), { includeDates: false });

  expect(catalog.graph.relationships).toContainEqual(
    expect.objectContaining({
      type: 'consumes',
      from: expect.objectContaining({ kind: 'event', id: 'order-completed' }),
      to: { kind: 'service', id: 'Warehouse Service' },
    }),
  );
});

it("never replaces what this site declares with another site's index", async () => {
  const checkouts = path.join(root, 'checkouts');

  await fs.mkdir(path.join(checkouts, 'orders/contracts/events'), { recursive: true });
  await fs.writeFile(
    path.join(checkouts, 'orders/contracts/events/order.completed.json'),
    JSON.stringify({
      type: 'object',
      properties: { orderId: { type: 'string' } },
      'x-autocatalog': { id: 'order.completed', domain: 'orders', version: '1.0.0' },
    }),
  );
  await fs.mkdir(path.join(checkouts, 'fulfillment'), { recursive: true });
  await fs.writeFile(
    path.join(checkouts, 'fulfillment/autocatalog.consumes.json'),
    JSON.stringify({
      consumes: [
        {
          service: 'Warehouse',
          event: 'orders/order.completed',
          queue: 'local-q',
          deadLetter: { queue: 'local-dlq' },
        },
      ],
    }),
  );

  const event = {
    kind: 'event',
    namespace: 'orders/orders',
    id: 'order.completed',
    version: '1.0.0',
  };

  const index = path.join(root, 'company-index.json');

  await fs.writeFile(
    index,
    JSON.stringify({
      spec: 'autocatalog/graph-v1',
      resources: [
        {
          ref: event,
          title: 'order.completed',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domain: 'orders', status: 'active', schema: './schema.json', examples: 0 },
        },
        {
          ref: { kind: 'service', id: 'Warehouse' },
          title: 'Warehouse',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domains: [] },
        },
      ],
      relationships: [
        {
          type: 'consumes',
          from: event,
          to: { kind: 'service', id: 'Warehouse' },
          provenance: 'declared',
          needsReview: false,
          source: { type: 'code', file: 'autocatalog.consumes.json' },
          attributes: { delivery: { queue: 'remote-q' }, deadLetter: { queue: 'remote-dlq' } },
        },
      ],
    }),
  );

  process.env.AUTOCATALOG_DOCS_INDEXES = index;

  const catalog = await buildDocsCatalog(checkouts, { includeDates: false });

  const edge = catalog.graph.relationships.find(
    (r) => r.type === 'consumes' && r.from.id === 'order.completed' && r.to.id === 'Warehouse',
  );

  expect(catalog.warnings.join('\n')).not.toMatch(/not joined/);
  expect(edge?.attributes).toMatchObject({
    delivery: { queue: 'local-q' },
    deadLetter: { queue: 'local-dlq' },
  });
});
