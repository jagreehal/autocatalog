import { expect, it } from 'vitest';
import { readKong } from '../src/index';

const platform = `_format_version: "3.0"
plugins:
  - name: jwt
  - name: rate-limiting
consumers:
  - username: partner
    jwt_secrets:
      - rsa_public_key: "\${{ env "DECK_JWT_PUBLIC_KEY" }}"
    plugins:
      - name: key-auth
`;

const team = `_format_version: "3.0"
services:
  - name: users-api
    url: http://users-api:3001/v1
    routes:
      - name: users
        paths: ["~/users$", "~/users/[^/]+$"]
        methods: [get, POST]
        strip_path: false
      - name: legacy
        paths: [/old]
        plugins:
          - name: key-auth
            enabled: false
`;

it('reads a platform file and a team file as one configuration', () => {
  const { file, warnings } = readKong([platform, team], { services: { 'users-api': 'users' } });

  expect(warnings).toEqual([]);
  expect(file).toEqual({
    gateway: 'kong',
    routes: [
      {
        name: 'users',
        service: 'users',
        patterns: ['/users$', '/users/[^/]+$'],
        methods: ['GET', 'POST'],
        stripPath: false,
        upstreamPath: '/v1',
        auth: ['jwt'],
      },
      {
        name: 'legacy',
        service: 'users',
        paths: ['/old'],
        stripPath: true,
        upstreamPath: '/v1',
        auth: ['jwt'],
      },
    ],
  });
});

it('sees a route with nothing in front of it', () => {
  const { file } = readKong([team]);

  expect(file.routes.map(({ auth }) => auth)).toEqual([[], []]);
});

it('refuses a file that is not a Kong configuration', () => {
  expect(() => readKong(['services: nope'])).toThrow(/not a Kong declarative configuration/);
});

it('takes the most specific instance of a plugin, as Kong runs it', () => {
  const routes = (plugins: string) => `_format_version: "3.0"
plugins:
  - name: jwt
services:
  - name: users-api
    url: http://users-api:3001
    routes:
      - name: users
        paths: [/users]
        plugins:
${plugins}
`;

  const authOf = (plugins: string) => readKong([routes(plugins)]).file.routes[0]?.auth;

  expect(authOf('          - name: rate-limiting')).toEqual(['jwt']);
  expect(authOf('          - name: jwt\n            enabled: false')).toEqual([]);
  expect(
    authOf('          - name: jwt\n            config:\n              anonymous: guest'),
  ).toEqual([]);
});
