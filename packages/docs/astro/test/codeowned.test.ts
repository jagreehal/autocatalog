import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseResourceGraph, type ResourceGraph } from 'autocatalog-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { withCodeowners } from '../src/codeowned';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-codeowned-'));
  await fs.mkdir(path.join(root, 'services/orders-api/contracts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'CODEOWNERS'),
    [
      '*                       @example-org/platform',
      '/services/orders-api/   @example-org/orders-team',
      '/gateway/               @example-org/edge-team',
      '/README.md              @example-org/docs-team',
    ].join('\n'),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const resource = (ref: { kind: string; namespace?: string; id: string }, extra = {}) => ({
  ref,
  title: ref.id,
  tags: [],
  provenance: { default: 'inferred', fields: {} },
  needsReview: true,
  attributes: {},
  ...extra,
});

// A monorepo as `ac site` reads one: each service package is its own repository.
const graph: ResourceGraph = parseResourceGraph({
  spec: 'autocatalog/graph-v1',
  resources: [
    resource(
      { kind: 'endpoint', namespace: 'orders-api/openapi', id: 'GET /orders' },
      {
        source: { repo: 'orders-api', file: 'contracts/openapi.json' },
        attributes: { method: 'GET', path: '/orders' },
      },
    ),
    resource({ kind: 'service', id: 'orders-api' }),
    resource({ kind: 'service', id: 'unnamed-api' }),
    resource(
      { kind: 'gateway', namespace: 'gateway', id: 'kong' },
      { source: { repo: 'gateway', file: 'compose/platform.yml' } },
    ),
    resource({ kind: 'repository', id: 'shop' }),
    resource(
      { kind: 'document', namespace: 'shop', id: 'lab' },
      {
        source: { repo: 'shop', file: 'docs/lab.md' },
        owner: { team: 'docs-team' },
        provenance: { default: 'declared', fields: {} },
      },
    ),
  ],
  relationships: [],
});

const repositories = () => [
  { name: 'shop', root },
  { name: 'orders-api', root: path.join(root, 'services/orders-api') },
  { name: 'gateway', root: path.join(root, 'gateway') },
];

const apis = [
  { repository: 'orders-api', file: 'contracts/openapi.json', services: ['orders-api'] },
];

const owners = async () => {
  const owned = await withCodeowners(graph, repositories(), apis, root);

  return Object.fromEntries(owned.resources.map(({ ref, owner }) => [ref.id, owner?.team]));
};

it('owns what a repository publishes by the CODEOWNERS rule for the file it came from', async () => {
  await fs.mkdir(path.join(root, 'gateway'));

  expect(await owners()).toMatchObject({
    'GET /orders': 'example-org/orders-team',
    kong: 'example-org/edge-team',
  });
});

it('owns a service where its spec is owned, and a repository by its catch-all', async () => {
  await fs.mkdir(path.join(root, 'gateway'));

  expect(await owners()).toMatchObject({
    'orders-api': 'example-org/orders-team',
    shop: 'example-org/platform',
  });
});

it('keeps a declared owner, and leaves a service no spec names unowned', async () => {
  await fs.mkdir(path.join(root, 'gateway'));

  const result = await owners();

  expect(result.lab).toBe('docs-team');
  expect(result['unnamed-api']).toBeUndefined();
});

it('marks an owner it found as inferred, so the page says a person should confirm it', async () => {
  await fs.mkdir(path.join(root, 'gateway'));

  const owned = await withCodeowners(graph, repositories(), apis, root);
  const service = owned.resources.find(({ ref }) => ref.id === 'orders-api')!;

  expect(service.provenance.fields.owner).toBe('inferred');
});

it('leaves the graph as it was when there is no CODEOWNERS', async () => {
  await fs.rm(path.join(root, 'CODEOWNERS'));

  expect(await withCodeowners(graph, repositories(), apis, root)).toBe(graph);
});
