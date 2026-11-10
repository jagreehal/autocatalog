import { expect, it } from 'vitest';
import { mapHeight } from '../src/ui/lib/visualiser';

const node = (id: string) => ({ id, type: 'service' as const, label: id });

const edge = (source: string, target: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  type: 'sends' as const,
});

it('gives a chain of three a short box, so it opens near full size', () => {
  const chain = { nodes: ['a', 'b', 'c'].map(node), edges: [edge('a', 'b'), edge('b', 'c')] };

  expect(mapHeight(chain, 30)).toBe(17.25);
});

it('grows with the busiest column, up to the page’s cap', () => {
  const fan = {
    nodes: ['hub', 'a', 'b', 'c', 'd'].map(node),
    edges: ['a', 'b', 'c', 'd'].map((to) => edge('hub', to)),
  };

  expect(mapHeight(fan, 30)).toBe(30);
  expect(mapHeight(fan, 20)).toBe(20);
});

it('settles on a cycle', () => {
  const loop = { nodes: ['a', 'b'].map(node), edges: [edge('a', 'b'), edge('b', 'a')] };

  expect(mapHeight(loop, 30)).toBe(17.25);
});
