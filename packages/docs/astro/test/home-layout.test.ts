import {
  DEFAULT_HOME_LAYOUT,
  DEFAULT_PUBLIC_HOME_LAYOUT,
  siteConfigSchema,
} from 'autocatalog-docs-core';
import { expect, it } from 'vitest';
import { resolveHomeLayout, type HomeLayoutContext } from '../src/home-layout';
import { checkHomeLayout } from '../src/index';
import { HOME_PAGE_ORDER, homePageBlocks } from '../src/ui/pages/HomePage';

const doc = (id: string) => ({
  id,
  repo: id.split('/')[0]!,
  title: id,
  owner: '',
  updated: null,
  tags: [],
});

const context: HomeLayoutContext = {
  base: '/docs/',
  stats: (kinds) => (kinds ?? ['service']).map((kind) => ({ label: kind, value: 1, kind })),
  documents: [doc('api/getting-started/introduction'), doc('api/guides/paging')],
  repos: [{ name: 'api', label: 'API', docs: [doc('api/getting-started/introduction')] }],
  apis: [
    { title: 'Payments API', text: '3 operations.', href: '/docs/apis/api/openapi/', icon: 'api' },
  ],
  explore: [
    { title: 'Services', text: 'Every service.', href: '/docs/services/', icon: 'service' },
  ],
  tags: [['start', [doc('api/getting-started/introduction')]]],
  catalogHref: '/docs/catalog/',
};

it('fills each built-in block from the catalog, and passes a site block its props', () => {
  const layout = resolveHomeLayout(
    [
      { block: 'hero', actions: [{ label: 'Start', href: '/getting-started/introduction/' }] },
      {
        block: 'cards',
        items: [{ title: 'Status', href: 'https://status.acme.test', icon: 'nope' }],
      },
      { block: 'countCards', kinds: ['event', 'domain'] },
      { block: 'docs', folder: 'getting-started' },
      { block: 'apis' },
      { block: 'pricing', plans: 3 },
    ],
    context,
  );

  expect(layout).toEqual([
    {
      custom: false,
      data: {
        block: 'hero',
        title: undefined,
        text: undefined,
        actions: [{ label: 'Start', href: '/docs/getting-started/introduction/' }],
      },
    },
    {
      custom: false,
      data: {
        block: 'cards',
        title: undefined,
        cards: [{ title: 'Status', href: 'https://status.acme.test', text: '', icon: 'doc' }],
      },
    },
    {
      custom: false,
      data: {
        block: 'countCards',
        stats: [
          { label: 'event', value: 1, kind: 'event' },
          { label: 'domain', value: 1, kind: 'domain' },
        ],
      },
    },
    {
      custom: false,
      data: { block: 'docs', title: undefined, items: [doc('api/getting-started/introduction')] },
    },
    { custom: false, data: { block: 'apis', title: undefined, cards: context.apis } },
    { custom: true, name: 'pricing', props: { plans: 3 } },
  ]);
});

it("checks a built-in block's props in autocatalog.site.json, and leaves a site's own to it", () => {
  const parse = (home: unknown[]) => siteConfigSchema.safeParse({ layouts: { home } });

  expect(
    parse([
      { block: 'hero', title: 'Hi' },
      { block: 'pricing', anything: true },
    ]).success,
  ).toBe(true);

  const wrong = parse([{ block: 'cards' }]);

  expect(wrong.success).toBe(false);
  expect(wrong.error?.issues[0]?.message).toMatch(/^cards: /);
});

it('is the built-in home page when the site writes no layout', () => {
  expect(DEFAULT_HOME_LAYOUT.map(({ block }) => block)).toEqual([...HOME_PAGE_ORDER]);

  const resolved = resolveHomeLayout(DEFAULT_HOME_LAYOUT, context).map((entry) =>
    entry.custom ? entry.name : entry.data,
  );

  expect(resolved).toEqual(
    homePageBlocks({
      stats: context.stats(),
      explore: context.explore,
      repos: context.repos,
      tags: context.tags,
      attention: context.attention,
      map: context.map,
      catalogHref: context.catalogHref,
    }).map((block) => ({ title: undefined, ...block })),
  );
});

it('fails a layout naming a block nobody provides, or one an audience never sees', () => {
  const layout = (home: Array<{ block: string }>, audience?: string) => ({
    layouts: { home },
    ...(audience && { audience }),
  });

  expect(() => checkHomeLayout(layout([{ block: 'pricing' }]), {})).toThrow(
    "layouts.home: no block 'pricing'",
  );
  expect(() =>
    checkHomeLayout(layout([{ block: 'pricing' }]), { pricing: './P.astro' }),
  ).not.toThrow();
  expect(() => checkHomeLayout(layout([{ block: 'graph' }], 'developers'), {})).toThrow(
    `a site for "developers" does not show 'graph'`,
  );
  expect(() => checkHomeLayout(layout(DEFAULT_PUBLIC_HOME_LAYOUT, 'developers'), {})).not.toThrow();
});

it("fails an extension's block that takes a built-in block's name", () => {
  expect(() => checkHomeLayout({}, { hero: './Hero.astro' })).toThrow(
    "a block named 'hero' takes the name of a built-in block",
  );
});
