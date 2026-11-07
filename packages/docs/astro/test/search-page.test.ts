import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SearchPage } from '../src/ui/pages/SearchPage';

const marks = (html: string) => [...html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g)].map((m) => m[1]);

it('marks the longest of the words a result shows, and counts what matched', () => {
  const html = renderToStaticMarkup(
    createElement(SearchPage, {
      query: 'pay payee',
      words: ['pay', 'payee'],
      results: [{ title: 'Payees', href: '/payees/', excerpt: 'Who you pay.' }],
      total: 31,
    }),
  );

  expect(marks(html)).toEqual(['Payee', 'pay']);
  expect(html).toContain('31 pages, showing the best 1');
});

it('offers what the site gives it when nothing matches', () => {
  const html = renderToStaticMarkup(
    createElement(SearchPage, {
      query: 'dolby',
      words: ['dolby'],
      results: [],
      total: 0,
      empty: createElement('button', null, 'Ask about it'),
    }),
  );

  expect(html).toContain('Nothing matches “dolby”');
  expect(html).toContain('<button>Ask about it</button>');
});
