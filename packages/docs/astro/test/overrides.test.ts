import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocFooterChrome } from '../src/ui/overrides/DocFooterChrome';
import { docHead, eventHead } from '../src/ui/overrides/fixtures';
import { PageTitleChrome } from '../src/ui/overrides/PageTitleChrome';

// The Starlight overrides are thin Astro shells around these components; what
// they render is checked here as static markup.
const render = <P extends object>(Component: ComponentType<P>, props: P) =>
  renderToStaticMarkup(createElement(Component, props));

describe('PageTitleChrome states', () => {
  it('names the resource by its catalog key, with its summary, pills and the filter Search reads', () => {
    const html = render(PageTitleChrome, {
      ...eventHead,
      children: createElement('h1', null, 'T'),
    });

    expect(html).toMatch(/<code[^>]*>event:payments\/payment\.completed<\/code>/);
    expect(html).toContain('Emitted once a payment has been captured');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('data-pagefind-filter="kind:Event"');
    expect(html).toContain('<h1>T</h1>');
  });

  it('offers a document its Markdown twin, copied through a button', () => {
    const html = render(PageTitleChrome, docHead);

    expect(html).toContain('data-copy-from="/payments-service/runbook.md"');
    expect(html).toContain('<span data-label="">Copy page as Markdown</span>');
    expect(html).toContain('href="/payments-service/runbook.md"');
    expect(html).toContain('data-copy-status');
  });

  it('renders no key, pills or actions for a bare page', () => {
    const html = render(PageTitleChrome, { pills: [], actions: [] });

    expect(html).not.toContain('<code');
    expect(html).not.toContain('data-slot="badge"');
    expect(html).not.toContain('aria-label="Page actions"');
    expect(html).not.toContain('data-pagefind-filter');
  });

  it('links a primary action beside the title', () => {
    const html = render(PageTitleChrome, {
      pills: [],
      actions: [],
      primary: { label: 'Explore catalog', href: '/catalog/' },
    });

    expect(html).toMatch(/<a [^>]*href="\/catalog\/"[^>]*>Explore catalog/);
  });
});

describe('DocFooterChrome states', () => {
  const base = {
    base: '/docs/',
    siteTitle: 'Acme',
    known: true,
    related: [],
    linkedFrom: [],
    about: [],
    repository: 'payments-service',
    defined: [],
  };

  it('names the owner, the change and where the source lives', () => {
    const html = render(DocFooterChrome, {
      ...base,
      owner: 'Payments',
      ownerHref: '/owners/payments/',
      changed: '4 Mar 2026',
      source: 'https://example.com/s',
      edit: 'https://example.com/e',
    });

    expect(html).toMatch(
      /Owned by <strong><a href="\/owners\/payments\/"[^>]*>Payments<\/a><\/strong>/,
    );
    expect(html).toContain('Last changed 4 Mar 2026');
    expect(html).toContain('>Edit this page</a>');
  });

  it('says so when git could not date a document', () => {
    expect(render(DocFooterChrome, base)).toContain('Last change unknown');
  });

  it('leaves out the meta row for a page that is neither owned nor a document', () => {
    expect(render(DocFooterChrome, { ...base, known: false })).not.toContain('Last change');
  });

  it('lists what its repository defines, counted correctly', () => {
    const one = render(DocFooterChrome, {
      ...base,
      defined: [{ kind: 'event', id: 'a', title: 'A', href: '/catalog#event-a' }],
    });

    expect(one).toContain('also defines 1 resource by convention.');
    expect(one).toMatch(/<code[^>]*>event\/a<\/code>/);
    expect(one).toContain('href="/docs/catalog.json"');
  });

  it("closes with the site footer, after Starlight's own", () => {
    const html = render(DocFooterChrome, {
      ...base,
      children: createElement('footer', null, 'starlight'),
    });

    expect(html.indexOf('starlight')).toBeLessThan(html.indexOf('aria-label="Machine-readable"'));
    expect(html).toContain('href="/docs/llms.txt"');
  });
});
