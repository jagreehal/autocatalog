import { expect, it } from 'vitest';
import { dropRepeatedTitle } from '../src/remark-title';

const heading = (depth: number, value: string) => ({
  type: 'heading',
  depth,
  children: [{ type: 'text', value }],
});

const tree = () => ({
  type: 'root',
  children: [heading(1, 'Incident communications'), { type: 'paragraph', value: 'Body' }],
});

it('drops an opening heading that repeats the page title', () => {
  const root = tree();

  dropRepeatedTitle(root, 'incident Communications ');

  expect(root.children.map(({ type }) => type)).toEqual(['paragraph']);
});

it('keeps a heading that says something else, or comes later', () => {
  const other = tree();

  dropRepeatedTitle(other, 'Runbook');
  expect(other.children).toHaveLength(2);

  const later = { type: 'root', children: [{ type: 'paragraph' }, heading(1, 'Runbook')] };

  dropRepeatedTitle(later, 'Runbook');
  expect(later.children).toHaveLength(2);
});
