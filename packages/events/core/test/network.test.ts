import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { emptyResourceGraph } from '../src/architecture';
import { withNetworkPolicies } from '../src/network';
import type { CatalogRelationship, ResourceGraph } from '../src/resource-graph';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-network-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const call = (
  from: string,
  to: string,
  provenance: 'declared' | 'observed',
): CatalogRelationship => ({
  type: 'calls',
  from: { kind: 'service', id: from },
  to: { kind: 'service', id: to },
  provenance,
  needsReview: false,
});

const findings = async (graph: ResourceGraph) => {
  await fs.writeFile(
    path.join(root, 'autocatalog.network.json'),
    JSON.stringify({
      workloads: [
        {
          service: 'users-api',
          namespace: 'team-users',
          ingress: [{ namespace: 'kong' }, { service: 'orders-api' }],
        },
        { service: 'orders-api', namespace: 'team-orders', egress: [{ namespace: 'team-users' }] },
        { service: 'reports', namespace: 'team-reports' },
        { service: 'billing', namespace: 'team-billing', ingress: [] },
      ],
    }),
  );

  const said: string[] = [];

  await withNetworkPolicies(graph, [{ repository: 'cluster', dir: root }], (message) =>
    said.push(message),
  );

  return said;
};

it('says where a call is one the network policy does not let through', async () => {
  const graph = {
    ...emptyResourceGraph(),
    relationships: [
      call('orders-api', 'users-api', 'declared'),
      call('reports', 'users-api', 'observed'),
      call('orders-api', 'reports', 'declared'),
      call('unknown', 'users-api', 'declared'),
    ],
  };

  expect(await findings(graph)).toEqual([
    "cluster: autocatalog.network.json: reports was seen calling users-api, and users-api's network policy does not let reports reach it",
    "cluster: autocatalog.network.json: orders-api calls reports, and orders-api's network policy does not let it reach reports",
  ]);
});

it('says a service a gateway exposes can be reached around it', async () => {
  const graph: ResourceGraph = {
    ...emptyResourceGraph(),
    resources: [
      {
        ref: { kind: 'gateway', namespace: 'gw', id: 'kong' },
        title: 'kong',
        tags: [],
        provenance: { default: 'extracted', fields: {} },
        needsReview: false,
        attributes: {},
      },
    ],
    relationships: (['reports', 'users-api'] as const).flatMap((service): CatalogRelationship[] => [
      {
        type: 'exposedBy',
        from: { kind: 'endpoint', namespace: service, id: 'GET /a' },
        to: { kind: 'service', id: service },
        provenance: 'declared',
        needsReview: false,
      },
      {
        type: 'exposedBy',
        from: { kind: 'endpoint', namespace: service, id: 'GET /a' },
        to: { kind: 'gateway', namespace: 'gw', id: 'kong' },
        provenance: 'extracted',
        needsReview: false,
      },
    ]),
  };

  expect(await findings(graph)).toEqual([
    'cluster: autocatalog.network.json: reports is exposed through kong, and its network policy lets any workload reach it directly',
  ]);
});

it('checks every description of a workload, so a looser copy hides nothing', async () => {
  const looser = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-network-'));

  await fs.writeFile(
    path.join(looser, 'autocatalog.network.json'),
    JSON.stringify({ workloads: [{ service: 'users-api', namespace: 'team-users' }] }),
  );

  await fs.writeFile(
    path.join(root, 'autocatalog.network.json'),
    JSON.stringify({
      workloads: [
        { service: 'users-api', namespace: 'team-users', ingress: [{ namespace: 'kong' }] },
        { service: 'reports', namespace: 'team-reports' },
      ],
    }),
  );

  const said: string[] = [];

  await withNetworkPolicies(
    { ...emptyResourceGraph(), relationships: [call('reports', 'users-api', 'observed')] },
    [
      { repository: 'cluster', dir: root },
      { repository: 'elsewhere', dir: looser },
    ],
    (message) => said.push(message),
  );

  await fs.rm(looser, { recursive: true, force: true });

  expect(said).toEqual([
    'users-api is described by the network policy of cluster and elsewhere: each is checked',
    "cluster: autocatalog.network.json: reports was seen calling users-api, and users-api's network policy does not let reports reach it",
  ]);
});

it('judges no call from a namespace a policy lets only some of in', async () => {
  await fs.writeFile(
    path.join(root, 'autocatalog.network.json'),
    JSON.stringify({
      workloads: [
        {
          service: 'users-api',
          namespace: 'team-users',
          ingress: [{ namespace: 'kong', some: true }],
        },
        { service: 'admin', namespace: 'kong' },
        { service: 'reports', namespace: 'team-reports' },
      ],
    }),
  );

  const said: string[] = [];

  await withNetworkPolicies(
    {
      ...emptyResourceGraph(),
      relationships: [
        call('admin', 'users-api', 'declared'),
        call('reports', 'users-api', 'declared'),
      ],
    },
    [{ repository: 'cluster', dir: root }],
    (message) => said.push(message),
  );

  expect(said).toEqual([
    "cluster: autocatalog.network.json: reports calls users-api, and users-api's network policy does not let reports reach it",
  ]);
});
