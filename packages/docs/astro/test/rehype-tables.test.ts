import { expect, it } from 'vitest';
import { focusTables } from '../src/rehype-tables';

it('lets the keyboard reach every table, however deep', () => {
  const table = { type: 'element', tagName: 'table', properties: {}, children: [] };

  focusTables({ type: 'root', children: [{ type: 'element', tagName: 'div', children: [table] }] });

  expect(table.properties).toEqual({ tabIndex: 0 });
});
