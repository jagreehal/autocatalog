import { expect, it } from 'vitest';
import { compareGateways } from '../src/compare';

it('compares two configurations route by route, whatever their names', () => {
  const compose = {
    gateway: 'kong',
    routes: [
      {
        name: 'users',
        service: 'users-api',
        patterns: ['/users$', '/users/[^/]+$'],
        methods: ['GET' as const, 'POST' as const],
        stripPath: false,
        auth: ['jwt'],
      },
    ],
  };

  const kubernetes = {
    gateway: 'kong',
    routes: [
      {
        name: 'users-get',
        service: 'users-api',
        patterns: ['/users$', '/users/[^/]+$'],
        methods: ['GET' as const],
        stripPath: false,
        auth: ['jwt'],
      },
      {
        name: 'users-post',
        service: 'users-api',
        patterns: ['/users$'],
        methods: ['POST' as const],
        stripPath: false,
        auth: [],
      },
    ],
  };

  expect(compareGateways(compose, kubernetes, ['compose', 'k8s'])).toEqual([
    'only compose lets through users-api POST ~/users/[^/]+$ (auth jwt)',
    'users-api POST ~/users$: auth jwt in compose, no auth in k8s',
  ]);
  expect(compareGateways(compose, compose, ['a', 'b'])).toEqual([]);
});

it('keeps a public route beside a guarded one for the same path', () => {
  const guarded = {
    name: 'users',
    service: 'users-api',
    paths: ['/users'],
    methods: ['GET' as const],
    stripPath: false,
    auth: ['jwt'],
  };

  const both = { gateway: 'kong', routes: [{ ...guarded, name: 'open', auth: [] }, guarded] };

  expect(compareGateways(both, { gateway: 'kong', routes: [guarded] }, ['a', 'b'])).toEqual([
    'users-api GET /users*: auth jwt | no auth in a, auth jwt in b',
  ]);
});
