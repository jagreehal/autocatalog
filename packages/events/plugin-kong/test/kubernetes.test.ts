import { expect, it } from 'vitest';
import { readKong } from '../src/index';

const platform = `apiVersion: v1
kind: Namespace
metadata:
  name: team-users
  labels: { gateway-access: public }
---
apiVersion: v1
kind: Namespace
metadata:
  name: team-other
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: public, namespace: kong }
spec:
  gatewayClassName: kong
  listeners:
    - name: https
      allowedRoutes:
        namespaces:
          from: Selector
          selector: { matchLabels: { gateway-access: public } }
---
apiVersion: configuration.konghq.com/v1
kind: KongClusterPlugin
metadata:
  name: jwt
  labels: { global: "true" }
plugin: jwt
`;

const route = (namespace: string, plugins = '') => `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: users
  namespace: ${namespace}
  annotations: { konghq.com/plugins: "${plugins}" }
spec:
  parentRefs: [{ name: public, namespace: kong }]
  rules:
    - matches:
        - path: { type: Exact, value: /users }
          method: GET
        - path: { type: RegularExpression, value: "/users/[^/]+" }
          method: GET
        - path: { type: PathPrefix, value: /users }
          method: POST
      backendRefs: [{ name: users-api, port: 3001 }]
`;

const disabledJwt = `---
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata: { name: no-jwt, namespace: team-users }
plugin: jwt
disabled: true
`;

it('reads HTTPRoutes and the plugins Kong attaches to them', () => {
  const { file, warnings } = readKong([platform, route('team-users')]);

  expect(warnings).toEqual([]);
  expect(file.routes).toEqual([
    {
      name: 'users-get',
      service: 'users-api',
      patterns: ['/users$', '/users/[^/]+$'],
      methods: ['GET'],
      stripPath: false,
      auth: ['jwt'],
    },
    {
      name: 'users-post',
      service: 'users-api',
      paths: ['/users'],
      methods: ['POST'],
      stripPath: false,
      auth: ['jwt'],
    },
  ]);
});

it('takes the route plugin over the global one, as Kong does', () => {
  const { file } = readKong([platform, route('team-users', 'no-jwt') + disabledJwt]);

  expect(file.routes.map(({ auth }) => auth)).toEqual([[], []]);
});

it('leaves out a route its namespace may not attach to the Gateway, and says why', () => {
  const { file, warnings } = readKong([platform, route('team-other')]);

  expect(file.routes).toEqual([]);
  expect(warnings).toEqual([
    'HTTPRoute team-other/users is not attached, so it was left out: namespace team-other may not attach routes to the Gateway kong/public',
  ]);
});
