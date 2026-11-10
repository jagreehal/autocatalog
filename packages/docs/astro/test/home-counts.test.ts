import { expect, it } from 'vitest';
import { homeCounts } from '../src/page-models';

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
