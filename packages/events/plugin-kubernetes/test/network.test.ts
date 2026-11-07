import { expect, it } from 'vitest';
import { readNetwork } from '../src/index';

const manifests = `apiVersion: v1
kind: Namespace
metadata: { name: team-users }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: users-api, namespace: team-users }
spec: { template: { metadata: { labels: { app: users-api } } } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: orders-api, namespace: team-orders }
spec: { template: { metadata: { labels: { app: orders-api } } } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: reports, namespace: team-reports }
spec: { template: { metadata: { labels: { app: reports } } } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: users-api, namespace: team-users }
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kong } }
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: team-orders } }
          podSelector: { matchLabels: { app: orders-api } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: reports, namespace: team-reports }
spec:
  podSelector: { matchLabels: { app: reports } }
  ingress:
    - {}
`;

it('reads who may reach each workload, and leaves open what no policy closes', () => {
  const { file, warnings } = readNetwork([manifests], { reports: 'reporting' });

  expect(warnings).toEqual([]);
  expect(file.workloads).toEqual([
    {
      service: 'users-api',
      namespace: 'team-users',
      ingress: [{ namespace: 'kong' }, { service: 'orders-api' }],
    },
    { service: 'orders-api', namespace: 'team-orders' },
    { service: 'reporting', namespace: 'team-reports' },
  ]);
});

it('reads matchExpressions, and an empty peer list as everyone', () => {
  const policy = `apiVersion: apps/v1
kind: Deployment
metadata: { name: users-api, namespace: team-users }
spec: { template: { metadata: { labels: { app: users-api } } } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: orders-api, namespace: team-users }
spec: { template: { metadata: { labels: { app: orders-api, tier: web } } } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: batch, namespace: team-users }
spec: { template: { metadata: { labels: { app: batch } } } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: users-api, namespace: team-users }
spec:
  podSelector: { matchExpressions: [{ key: app, operator: In, values: [users-api] }] }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector: { matchExpressions: [{ key: tier, operator: Exists }] }
  egress:
    - to: []
`;

  expect(readNetwork([policy]).file.workloads).toEqual([
    { service: 'users-api', namespace: 'team-users', ingress: [{ service: 'orders-api' }] },
    { service: 'orders-api', namespace: 'team-users' },
    { service: 'batch', namespace: 'team-users' },
  ]);
});

it('reads a peer that admits every namespace, or the whole internet, as anyone', () => {
  const open = (peer: string) => `apiVersion: apps/v1
kind: Deployment
metadata: { name: users-api, namespace: team-users }
spec: { template: { metadata: { labels: { app: users-api } } } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: users-api, namespace: team-users }
spec:
  podSelector: {}
  ingress:
    - from: [${peer}]
`;

  for (const peer of ['{ namespaceSelector: {} }', '{ ipBlock: { cidr: 0.0.0.0/0 } }'])
    expect(readNetwork([open(peer)]).file.workloads).toEqual([
      { service: 'users-api', namespace: 'team-users' },
    ]);
});
