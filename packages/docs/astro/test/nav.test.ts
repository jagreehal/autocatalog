import { describe, expect, it } from 'vitest';
import { catalogNav, liftSectionGroup, navLinks, portalNav, sectionSidebar } from '../src/nav';

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

describe('a developer portal', () => {
  const docs = ['api/start', 'api/guides/auth', 'help/faq'];

  it('is Documentation and API reference, the one API opened directly', () => {
    expect(portalNav(docs, ['apis/api/openapi/'])).toEqual([
      { label: 'Documentation', href: '/', icon: 'doc', match: ['/', '/api/', '/help/'] },
      { label: 'API reference', href: '/apis/api/openapi/', icon: 'api', match: '/apis/' },
    ]);
    expect(portalNav(docs, ['apis/a/one/', 'apis/b/two/'])[1]!.href).toBe('/apis/');
  });

  it('marks Documentation on the guides and API reference on the reference', () => {
    const sections = portalNav(docs, ['apis/api/openapi/']);

    const current = (page: string) => navLinks(sections, page).find((link) => link.current)?.label;

    expect(current('/')).toBe('Documentation');
    expect(current('/api/guides/auth/')).toBe('Documentation');
    expect(current('/apis/api/openapi/')).toBe('API reference');
  });

  it('is nothing without both guides and an API', () => {
    expect(portalNav([], ['apis/api/openapi/'])).toEqual([]);
    expect(portalNav(docs, [])).toEqual([]);
  });
});

// The first path segments of the pages the catalog compiles, as the build passes them.
const SEGMENTS = ['catalog', 'services', 'owners', 'events', 'apis', 'domains', 'findings'];

describe('a catalog that names no sections', () => {
  const sections = catalogNav(
    ['payments-service/runbook', 'payments-service/adr/001', 'ledger/guide'],
    SEGMENTS,
  );

  const current = (page: string) => navLinks(sections, page).find((link) => link.current)?.label;

  it('is Home, Catalog and Docs, Docs opening the shallowest document', () => {
    expect(sections.map(({ label, href }) => [label, href])).toEqual([
      ['Home', '/'],
      ['Catalog', '/catalog/'],
      ['Docs', '/payments-service/runbook'],
    ]);
    expect(catalogNav(['handbook/finance/invoices', 'handbook/incidents'], SEGMENTS)[2]!.href).toBe(
      '/handbook/incidents',
    );
    expect(catalogNav([], SEGMENTS).map(({ label }) => label)).toEqual(['Home', 'Catalog']);
    // The site's own home page is Home's, not a second Docs entry for the same page.
    expect(catalogNav(['', 'guide'], SEGMENTS)[2]!.href).toBe('/guide');
    expect(catalogNav([''], SEGMENTS).map(({ label }) => label)).toEqual(['Home', 'Catalog']);
  });

  it('marks Catalog on compiled pages and Docs on every repository’s documents', () => {
    expect(current('/')).toBe('Home');
    expect(current('/services/orders-api/')).toBe('Catalog');
    expect(current('/owners/')).toBe('Catalog');
    expect(current('/findings/capture-stuck/')).toBe('Catalog');
    expect(current('/ledger/guide/')).toBe('Docs');
    expect(current('/docs/x/')).toBeUndefined();
  });

  it('marks sections under the base a site is served from', () => {
    expect(
      navLinks(sections, '/autocatalog/services/a/', '/autocatalog/').find((l) => l.current)?.label,
    ).toBe('Catalog');
  });
});

describe('the sidebar for a section', () => {
  const sections = catalogNav(['handbook/intro'], SEGMENTS);

  const link = (href: string) => ({ type: 'link' as const, href });

  const group = (label: string, ...hrefs: string[]) => ({
    type: 'group' as const,
    label,
    entries: hrefs.map(link),
  });

  const sidebar = [
    group('Catalog', '/catalog/', '/services/', '/owners/'),
    group('Services', '/services/orders-api/', '/apis/orders-api/openapi/'),
    group('handbook', '/handbook/intro/'),
    group('Elsewhere', 'https://status.example.com'),
  ];

  const labels = (page: string, base?: string) =>
    sectionSidebar(
      base
        ? sidebar.map((g) => ({
            ...g,
            entries: g.entries.map((e) => link(`${base.replace(/\/$/, '')}${e.href}`)),
          }))
        : sidebar,
      sections,
      page,
      base,
    ).map((entry) => entry.label);

  it('holds the current section’s groups, and any group no section claims', () => {
    expect(labels('/services/orders-api/')).toEqual(['Catalog', 'Services', 'Elsewhere']);
    expect(labels('/handbook/intro/')).toEqual(['handbook', 'Elsewhere']);
  });

  it('keeps every group where no section, or a section with no group, holds the page', () => {
    expect(labels('/')).toEqual(['Catalog', 'Services', 'handbook', 'Elsewhere']);
    expect(labels('/nowhere/')).toEqual(['Catalog', 'Services', 'handbook', 'Elsewhere']);
  });

  it('reads the links under the base a site is served from', () => {
    expect(labels('/autocatalog/services/orders-api/', '/autocatalog/')).toEqual([
      'Catalog',
      'Services',
      'Elsewhere',
    ]);
  });
});

describe('a sidebar under its section’s heading', () => {
  const group = (label: string, ...hrefs: string[]) => ({
    type: 'group' as const,
    label,
    entries: hrefs.map((href) => ({ type: 'link' as const, href, label: href })),
  });

  it('lifts a first group named for the section, so the name is not said twice', () => {
    const lifted = liftSectionGroup(
      [group('Catalog', '/catalog/', '/owners/'), group('Services', '/services/')],
      'catalog',
    );

    expect(lifted.map((entry) => entry.label)).toEqual(['/catalog/', '/owners/', 'Services']);
  });

  it('leaves a sidebar whose first group has a name of its own', () => {
    const sidebar = [group('acme-handbook', '/acme-handbook/x/')];

    expect(liftSectionGroup(sidebar, 'Docs')).toBe(sidebar);
  });
});
