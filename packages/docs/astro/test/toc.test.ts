import { expect, it } from 'vitest';
import { withoutRepeatedOverview } from '../src/toc';

interface Entry {
  depth: number;
  slug: string;
  text: string;
  children: Entry[];
}

const entry = (slug: string, text: string, children: Entry[] = []): Entry => ({
  depth: 2,
  slug,
  text,
  children,
});

it("drops a page's own Overview heading and keeps Starlight's, which goes to the top", () => {
  const items = [
    entry('_top', 'Overview'),
    entry('overview', 'Overview', [entry('scope', 'Scope')]),
    entry('runbook', 'Runbook'),
  ];

  expect(withoutRepeatedOverview(items).map(({ slug }) => slug)).toEqual([
    '_top',
    'scope',
    'runbook',
  ]);
});

it('leaves contents alone when the first heading says something else', () => {
  const items = [entry('_top', 'Overview'), entry('install', 'Install')];

  expect(withoutRepeatedOverview(items)).toBe(items);
});
