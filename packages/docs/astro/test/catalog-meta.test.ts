import { AUTOCATALOG_GRAPH_SPEC } from 'autocatalog-core';
import { expect, it } from 'vitest';
import { catalogMeta } from '../src/catalog-meta';

const catalog = {
  graph: { spec: AUTOCATALOG_GRAPH_SPEC, resources: [], relationships: [] },
  failures: [{ repository: 'orders', source: 'events' as const, message: 'schema.json: not JSON' }],
};

const config = {
  leftOut: [{ name: 'billing', reason: 'could not clone' }],
  lockDigest: 'abc123',
  audience: undefined,
  access: undefined,
};

it('records when it was built, from which lock, and every source it left out', () => {
  expect(catalogMeta(catalog, config, new Date('2026-11-16T09:00:00Z'))).toEqual({
    spec: 'autocatalog/catalog-meta-v1',
    builtAt: '2026-11-16T09:00:00.000Z',
    lockDigest: 'abc123',
    resources: 0,
    relationships: 0,
    failures: 2,
    problems: [
      { repository: 'billing', source: 'clone', message: 'could not clone' },
      { repository: 'orders', source: 'events', message: 'schema.json: not JSON' },
    ],
  });
});

it('counts problems without naming them on a site for an audience', () => {
  const meta = catalogMeta(catalog, { ...config, audience: 'public' });

  expect(meta.failures).toBe(2);
  expect(meta.problems).toEqual([]);
});
