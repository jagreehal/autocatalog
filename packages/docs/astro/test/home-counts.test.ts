import { emptyResourceGraph } from 'autocatalog-core';
import type { CatalogRelationship } from 'autocatalog-core';
import { expect, it } from 'vitest';
import { catalogProvenance, homeCounts } from '../src/page-models';

const stat = (kind: string, value: number) => ({ label: `${kind}s`, value, kind });

const all = [
  stat('relationship', 47),
  stat('agent', 1),
  stat('command', 1),
  stat('document', 23),
  stat('event', 2),
  stat('model', 1),
  stat('queue', 1),
  stat('repository', 6),
  stat('service', 4),
  stat('term', 3),
  stat('domain', 2),
  stat('finding', 0),
];

it('leads with services, events, domains and documents, then the most held, six in all', () => {
  expect(homeCounts(all).map(({ kind }) => kind)).toEqual([
    'service',
    'event',
    'domain',
    'document',
    'repository',
    'term',
  ]);
});

it('counts what the site names, in its order, and nothing it holds none of', () => {
  expect(homeCounts(all, ['relationship', 'finding', 'agent']).map(({ kind }) => kind)).toEqual([
    'relationship',
    'agent',
  ]);
});

it('keeps the zeros of a catalog that holds nothing, so the page says what to add', () => {
  expect(homeCounts([stat('domain', 0)])).toEqual([stat('domain', 0)]);
  expect(homeCounts([stat('domain', 0)], ['domain'])).toEqual([]);
});

it('counts every fact once under where it came from, so the totals are the catalog’s', () => {
  const found = (['extracted', 'observed', 'declared', 'overridden', 'inferred'] as const).map(
    (provenance, index): CatalogRelationship => ({
      type: 'reads',
      from: { kind: 'service', id: `s${index}` },
      to: { kind: 'table', id: 't' },
      provenance,
      needsReview: false,
    }),
  );

  expect(
    catalogProvenance({ ...emptyResourceGraph(), relationships: found }).relationships,
  ).toEqual({ extracted: 2, declared: 2, inferred: 1 });
});
