// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogExplorer } from '../src/ui/components/CatalogExplorer';
import { explorerModel } from '../src/ui/components/catalog-explorer.fixture';
import { EventCatalogDiagram } from '../src/ui/components/EventCatalogDiagram';
import { SchemaTree } from '../src/ui/components/SchemaTree';
import { schemaTree } from '../src/ui/lib/schema-tree';
import { PageTitleChrome } from '../src/ui/overrides/PageTitleChrome';
import { FieldsPage, type FieldRow } from '../src/ui/pages/FieldsPage';
import { KindIndexPage } from '../src/ui/pages/KindIndexPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  history.replaceState(null, '', '/');
});

const explorer = () => render(createElement(CatalogExplorer, { model: explorerModel }));

const titles = () =>
  [...document.querySelectorAll('[data-resource] h2 a')].map((link) => link.textContent);

const status = () => screen.getByRole('status').textContent;

describe('CatalogExplorer behaviour', () => {
  it('filters by kind, and shows every kind again from All', () => {
    explorer();

    fireEvent.click(screen.getByRole('radio', { name: /^service/ }));

    expect(titles()).toEqual(['LedgerService', 'PaymentService']);
    expect(status()).toBe('2 resources');
    expect(screen.getByRole('radio', { name: /^service/ }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('radio', { name: /^All/ }));

    expect(titles()).toEqual(['Payment completed', 'LedgerService', 'PaymentService']);
  });

  it('matches the query against the search text, ignoring case and padding', () => {
    explorer();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  LEDGER ' } });

    expect(titles()).toEqual(['LedgerService']);
    expect(status()).toBe('1 resource');
  });

  it('narrows to the review queue and counts it as such', () => {
    explorer();

    fireEvent.click(screen.getByRole('button', { name: /Needs review/ }));

    expect(titles()).toEqual(['Payment completed', 'LedgerService']);
    expect(status()).toBe('2 resources to review');
  });

  it('clears every filter from the empty state and returns focus to the search', () => {
    explorer();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing matches this' } });
    fireEvent.click(screen.getByRole('radio', { name: /^service/ }));

    expect(titles()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(titles()).toHaveLength(3);
    expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('opens on the kind named in ?kind=, and ignores a kind the graph lacks', () => {
    history.replaceState(null, '', '/catalog?kind=service');
    explorer();

    expect(titles()).toEqual(['LedgerService', 'PaymentService']);

    cleanup();
    history.replaceState(null, '', '/catalog?kind=queue');
    explorer();

    expect(titles()).toHaveLength(3);
  });

  it('restores a connection target hidden by the current view before following it', () => {
    explorer();

    fireEvent.click(screen.getByRole('radio', { name: /^event/ }));
    expect(document.getElementById('resource-service-LedgerService')).toBeNull();

    const event = document.getElementById('resource-event-payments-payment.completed')!;

    // Connections sit in a collapsed disclosure; a reader opens it first.
    fireEvent.click(within(event).getByRole('button', { name: /connection/ }));

    act(() => {
      within(event).getByRole('link', { name: 'LedgerService' }).click();
    });

    expect(document.getElementById('resource-service-LedgerService')).not.toBeNull();
    expect(titles()).toHaveLength(3);
  });
});

describe('FieldsPage behaviour', () => {
  const field = (path: string, conflict: string | null, search: string): FieldRow => ({
    path,
    conflict,
    types: ['string'],
    carriers: [],
    consumers: [],
    search,
  });

  const visible = () =>
    [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].flatMap((row) =>
      row.hidden ? [] : [row.querySelector('code')?.textContent],
    );

  it('filters rows by text and by disagreement, together', () => {
    render(
      createElement(FieldsPage, {
        fields: [
          field('amount', 'number in one event, string in another', 'amount payment.captured'),
          field('currency', null, 'currency payment.captured'),
          field('ledgerId', 'required in one event only', 'ledgerid ledger.posted'),
        ],
        eventCount: 2,
        conflicts: 2,
        eventsHref: '/catalog?kind=event',
      }),
    );

    expect(visible()).toEqual(['amount', 'currency', 'ledgerId']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Only fields that disagree' }));
    expect(visible()).toEqual(['amount', 'ledgerId']);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Payment' } });
    expect(visible()).toEqual(['amount']);
  });
});

describe('SchemaTree behaviour', () => {
  const nodes = schemaTree({
    type: 'object',
    properties: {
      id: { type: 'string' },
      customer: {
        type: 'object',
        properties: {
          address: { type: 'object', properties: { postcode: { type: 'string' } } },
        },
      },
    },
  });

  const shown = () =>
    [...document.querySelectorAll('[role="treeitem"]')].map(
      (item) => item.querySelector('code')?.textContent,
    );

  const isOpen = (name: string) =>
    document
      .querySelector(`[data-name="${name}"] > [data-slot="collapsible"] > div > button`)!
      .getAttribute('aria-expanded') === 'true';

  it('keeps search and expand all out of the page until they can work', () => {
    expect(renderToString(createElement(SchemaTree, { nodes }))).toMatch(
      /<div[^>]*\shidden=""[^>]*\sdata-schema-bar=/,
    );

    render(createElement(SchemaTree, { nodes }));

    expect(screen.getByRole('searchbox', { name: 'Search properties' }).closest('[hidden]')).toBe(
      null,
    );
  });

  it('finds a nested property, opens its ancestors, and counts the matches', () => {
    render(createElement(SchemaTree, { nodes }));

    expect(isOpen('address')).toBe(false);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'POST' } });

    expect(shown()).toEqual(['customer', 'address', 'postcode']);
    expect(isOpen('address')).toBe(true);
    expect(screen.getByText('1 of 4 properties')).toBeTruthy();
  });

  it('expands and collapses every branch at once', () => {
    render(createElement(SchemaTree, { nodes }));

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect([isOpen('customer'), isOpen('address')]).toEqual([true, true]);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect([isOpen('customer'), isOpen('address')]).toEqual([false, false]);
  });
});

describe('EventCatalogDiagram behaviour', () => {
  it("loads the embed in the site's theme, and follows it when the reader switches", async () => {
    document.documentElement.dataset.theme = 'light';

    render(
      createElement(EventCatalogDiagram, {
        embed: true,
        iframeSrc: '/eventcatalog/visualiser/graph/?embed=true',
        openHref: '/architecture/',
        title: 'Architecture graph',
      }),
    );

    const frame = screen.getByTitle<HTMLIFrameElement>('Architecture graph');

    expect(frame.hidden).toBe(false);
    expect(new URL(frame.src).search).toBe('?embed=true&theme=light');

    await act(async () => {
      document.documentElement.dataset.theme = 'dark';
    });

    expect(new URL(frame.src).search).toBe('?embed=true&theme=dark');
  });
});

describe('Copy page as Markdown', () => {
  const title = () =>
    render(
      createElement(PageTitleChrome, {
        pills: [],
        actions: [{ label: 'Copy page as Markdown', href: '/docs/a.md', icon: 'copy', copy: true }],
      }),
    );

  it('copies what the Markdown twin serves, and tells a screen reader', async () => {
    const copied: string[] = [];

    vi.stubGlobal('fetch', async (href: string) => new Response(`# from ${href}`));
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async (text: string) => copied.push(text) },
    });
    title();

    fireEvent.click(screen.getByRole('button', { name: 'Copy page as Markdown' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(copied).toEqual(['# from /docs/a.md']);
    expect(screen.getByRole('status').textContent).toBe('Copied');
  });

  it('says the copy failed when the twin is missing', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    title();

    fireEvent.click(screen.getByRole('button', { name: 'Copy page as Markdown' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
  });
});

describe('KindIndexPage behaviour', () => {
  const row = (id: string, status: string) => ({
    id,
    title: id,
    href: `/payments/adr/${id}/`,
    repository: 'payments',
    status,
    cells: { status: { text: status, status: true } },
  });

  it('filters by a status of any spelling, one written like All included', () => {
    render(
      createElement(KindIndexPage, {
        columns: [{ field: 'status', heading: 'Status' }],
        rows: [row('first', ' all'), row('second', 'on hold')],
        statuses: [' all', 'on hold'],
        repositories: ['payments'],
        chains: [],
      }),
    );

    fireEvent.click(screen.getByRole('radio', { name: 'all 1' }));

    expect(status()).toBe('1 of 2 documents');

    fireEvent.click(screen.getByRole('radio', { name: 'on hold 1' }));

    expect(status()).toBe('1 of 2 documents');

    fireEvent.click(screen.getByRole('radio', { name: 'All 2' }));

    expect(status()).toBe('2 documents');
  });
});
