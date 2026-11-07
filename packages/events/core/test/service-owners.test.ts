import { expect, it } from 'vitest';
import { resolveServiceOwners } from '../src/service-owners';

const resolve = (
  claims: Record<string, string[]>,
  previous: Record<string, string> = {},
  chosen: Record<string, string> = {},
) => resolveServiceOwners({ claims: new Map(Object.entries(claims)), previous, chosen });

it('gives a service its one claimant', () => {
  expect(resolve({ users: ['users-api'] }).services).toEqual({ 'users-api': 'users' });
});

it('settles nothing two repositories claim, until one is chosen', () => {
  expect(resolve({ users: ['users-api'], copy: ['users-api'] })).toMatchObject({
    services: {},
    conflicts: [expect.stringContaining('users-api is claimed by copy and users')],
  });
  expect(
    resolve({ users: ['users-api'], copy: ['users-api'] }, {}, { 'users-api': 'copy' }).services,
  ).toEqual({ 'users-api': 'copy' });
});

it('keeps a pin a newcomer contests, and drops one its owner no longer claims', () => {
  expect(
    resolve({ users: ['users-api'], newcomer: ['users-api'] }, { 'users-api': 'users' }),
  ).toMatchObject({ services: { 'users-api': 'users' }, contested: [expect.any(String)] });
  expect(resolve({ users: [] }, { 'users-api': 'users' }).services).toEqual({});
});

it('keeps a pin to a repository not read this time', () => {
  expect(resolve({ orders: ['orders-api'] }, { 'users-api': 'users' }).services).toEqual({
    'orders-api': 'orders',
    'users-api': 'users',
  });
});

it('moves no pin away from an enrolled repository on its own', () => {
  expect(resolve({ users: [], copy: ['users-api'] }, { 'users-api': 'users' })).toMatchObject({
    services: {},
    conflicts: [expect.stringContaining('users-api is pinned to users, which no longer claims it')],
  });
});
