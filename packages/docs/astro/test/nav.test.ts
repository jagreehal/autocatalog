import { describe, expect, it } from 'vitest';
import { navLinks } from '../src/nav';

const links = [
  { label: 'Home', href: '/' },
  { label: 'Guides', href: '/guides/', match: ['/guides/', '/labels/'] },
  { label: 'API', href: '/guides/api/' },
  { label: 'Status', href: 'https://status.example.com' },
];

const current = (pathname: string, base?: string) =>
  navLinks(links, pathname, base)
    .filter((link) => link.current)
    .map((link) => link.label);

describe('header links', () => {
  it('marks home current on the home page only', () => {
    expect(current('/')).toEqual(['Home']);
    expect(current('/other/')).toEqual([]);
  });

  it('keeps a section current across its pages and every path it matches', () => {
    expect(current('/guides/setup/')).toEqual(['Guides']);
    expect(current('/guides')).toEqual(['Guides']);
    expect(current('/labels/royalties/')).toEqual(['Guides']);
  });

  it('lets the most specific section win', () => {
    expect(current('/guides/api/auth/')).toEqual(['API']);
  });

  it('does not take a section for a path that only starts with its name', () => {
    expect(current('/guidesbook/')).toEqual([]);
  });

  it('puts the base on site paths and leaves other sites alone', () => {
    const views = navLinks(links, '/docs/guides/x/', '/docs/');

    expect(views.map((link) => link.href)).toEqual([
      '/docs/',
      '/docs/guides/',
      '/docs/guides/api/',
      'https://status.example.com',
    ]);
    expect(views.filter((link) => link.current).map((link) => link.label)).toEqual(['Guides']);
    expect(views.map((link) => link.external)).toEqual([false, false, false, true]);
  });

  it('marks one link current when two match the same path', () => {
    const twins = [
      { label: 'A', href: '/a/' },
      { label: 'B', href: '/a/' },
    ];

    expect(navLinks(twins, '/a/').map((link) => link.current)).toEqual([true, false]);
  });
});
