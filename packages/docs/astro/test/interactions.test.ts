// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogExplorer } from '../src/ui/components/CatalogExplorer';
import { explorerModel, largeExplorerModel } from '../src/ui/components/catalog-explorer.fixture';
import { ServicesPage } from '../src/ui/pages/ServicesPage';
import type { ServicesPageRow } from '../src/ui/pages/ServicesPage';
import { EventCatalogDiagram } from '../src/ui/components/EventCatalogDiagram';
import { SchemaTree } from '../src/ui/components/SchemaTree';
import { schemaTree } from '../src/ui/lib/schema-tree';
import { PageTitleChrome } from '../src/ui/overrides/PageTitleChrome';
import { EventPage } from '../src/ui/pages/EventPage';
import type { EventPageProps } from '../src/ui/pages/EventPage';
import { FieldsPage } from '../src/ui/pages/FieldsPage';
import type { FieldRow } from '../src/ui/pages/FieldsPage';
import { eventFlow, evidence, noEvidence, schema } from '../src/ui/pages/fixtures';
import { HomeBlock } from '../src/ui/pages/HomeBlock';
import { KindIndexPage } from '../src/ui/pages/KindIndexPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  history.replaceState(null, '', '/');
});

// jsdom lays nothing out, so it has no scrolling to do.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const explorer = (model = explorerModel) => render(createElement(CatalogExplorer, { model }));

const titles = () =>
  [...document.querySelectorAll('[data-resource] a')].map((link) => link.textContent);

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

  it('opens on the search in ?q= and the review queue in ?review=1', () => {
    history.replaceState(null, '', '/catalog?q=Ledger');
    explorer();

    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'Ledger');
    expect(titles()).toEqual(['LedgerService']);

    cleanup();
    history.replaceState(null, '', '/catalog?review=1');
    explorer();

    expect(titles()).toEqual(['Payment completed', 'LedgerService']);
  });

  it('keeps provenance and connections behind a row expand', () => {
    explorer();

    expect(screen.queryByText('LedgerService', { selector: '[data-relations] a' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details of Payment completed' }));

    expect(
      screen
        .getByRole('button', { name: 'Details of Payment completed' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('LedgerService', { selector: '[data-relations] a' })).toBeTruthy();

    // The commit a resource was read at, shortened, with the whole hash on hover.
    fireEvent.click(screen.getByRole('button', { name: 'Details of PaymentService' }));

    expect(screen.getByTitle('0123456789abcdef').textContent).toBe('0123456789ab');
  });

  it('restores a connection target hidden by the current view before following it', async () => {
    explorer();

    // Its fragment is still in the page, but not in a row the view shows.
    const inRow = () =>
      document.getElementById('resource-service-LedgerService')?.closest('[data-resource]');

    fireEvent.click(screen.getByRole('radio', { name: /^event/ }));
    expect(inRow()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details of Payment completed' }));

    act(() => {
      screen.getByText('LedgerService', { selector: '[data-relations] a' }).click();
    });

    await waitFor(() => expect(inRow()).toBeTruthy());
    expect(titles()).toHaveLength(3);
    expect(
      screen
        .getByRole('button', { name: 'Details of LedgerService' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('names every row as a fragment in the page as built, the later pages too', () => {
    const html = renderToString(createElement(CatalogExplorer, { model: largeExplorerModel }));

    for (const row of largeExplorerModel.rows) {
      expect(html.split(`id="${row.anchor}"`)).toHaveLength(2);
    }
  });

  it('pages a long graph 25 rows at a time and counts what the page holds', () => {
    explorer(largeExplorerModel);

    expect(titles()).toHaveLength(25);
    expect(titles()[0]).toBe('Order step 1');
    expect(status()).toBe('1 to 25 of 60 resources');

    fireEvent.click(screen.getByRole('link', { name: 'Go to next page' }));

    expect(titles()[0]).toBe('Order step 26');
    expect(status()).toBe('26 to 50 of 60 resources');
    expect(location.search).toBe('?page=2');

    fireEvent.click(screen.getByRole('link', { name: 'Page 3' }));

    expect(titles()).toHaveLength(10);
    expect(status()).toBe('51 to 60 of 60 resources');

    // A narrower view starts again from its first page.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'step 1' } });

    expect(status()).toBe('11 resources');
    expect(screen.queryByRole('navigation', { name: 'Resource pages' })).toBeNull();
  });

  it('opens on the page in ?page=', () => {
    history.replaceState(null, '', '/catalog?page=3');
    explorer(largeExplorerModel);

    expect(titles()[0]).toBe('Order step 51');
  });

  it('sorts by a column, and reverses on a second press', () => {
    explorer(largeExplorerModel);

    const owner = () => screen.getByRole('columnheader', { name: /Owner/ });

    fireEvent.click(owner());

    expect(owner().getAttribute('aria-sort')).toBe('ascending');
    expect(
      [...document.querySelectorAll('[data-resource] td:nth-child(4)')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(Array.from({ length: 25 }, (_, index) => (index < 20 ? 'fulfilment' : 'orders')));

    fireEvent.click(owner());

    expect(owner().getAttribute('aria-sort')).toBe('descending');
    expect(titles()[0]).toBe('Order step 3');
  });

  it('lands a fragment on its row: on its page, opened, and scrolled to', () => {
    history.replaceState(null, '', '/catalog#resource-event%3Aorders%2Forder.step-40');
    explorer(largeExplorerModel);

    expect(status()).toBe('26 to 50 of 60 resources');
    expect(document.getElementById('resource-event%3Aorders%2Forder.step-40')).not.toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Details of Order step 40' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('lands a fragment the current filter hides by showing the whole graph', () => {
    history.replaceState(
      null,
      '',
      '/catalog?kind=service#resource-event-payments-payment.completed',
    );
    explorer();

    expect(titles()).toHaveLength(3);
    expect(
      screen
        .getByRole('button', { name: 'Details of Payment completed' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('follows a fragment that changes after the page has loaded', async () => {
    explorer(largeExplorerModel);

    act(() => {
      location.hash = 'resource-event%3Aorders%2Forder.step-59';
    });

    await waitFor(() => expect(status()).toBe('51 to 60 of 60 resources'));
  });
});

describe('ServicesPage behaviour', () => {
  const service = (index: number): ServicesPageRow => ({
    name: `service-${String(index).padStart(2, '0')}`,
    href: `/services/service-${index}/`,
    domains: [],
    apis: [],
    endpoints: 0,
    receives: [],
    sends: Array.from({ length: index % 4 }, (_, n) => ({
      label: `Event ${index}.${n}`,
      href: `/events/e-${index}-${n}/`,
    })),
    calls: [],
  });

  const services = Array.from({ length: 30 }, (_, index) => service(index + 1));

  const names = () =>
    [...document.querySelectorAll('[data-service] a')].map((link) => link.textContent);

  it('pages, sorts by what a service sends, and opens a row to the names behind its counts', () => {
    render(createElement(ServicesPage, { services }));

    expect(names()).toHaveLength(25);
    expect(status()).toBe('1 to 25 of 30 services');

    fireEvent.click(screen.getByRole('link', { name: 'Page 2' }));

    expect(names()).toEqual(['service-26', 'service-27', 'service-28', 'service-29', 'service-30']);

    fireEvent.click(screen.getByRole('columnheader', { name: /Sends/ }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Sends/ }));

    expect(names()[0]).toBe('service-03');
    expect(screen.queryByRole('link', { name: 'Event 3.2' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details of service-03' }));

    expect(screen.getByRole('link', { name: 'Event 3.2' }).getAttribute('href')).toBe(
      '/events/e-3-2/',
    );
  });

  it('keeps the sort in its pager links, so a link shows the same rows wherever it opens', () => {
    render(createElement(ServicesPage, { services }));

    fireEvent.click(screen.getByRole('columnheader', { name: /Sends/ }));

    expect(screen.getByRole('link', { name: 'Page 2' }).getAttribute('href')).toBe(
      '?sort=sends&dir=asc&page=2',
    );
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
    const copied: Array<string> = [];

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

  it('copies the page itself as Markdown when there is no twin', async () => {
    const copied: Array<string> = [];

    vi.stubGlobal('navigator', {
      clipboard: { writeText: async (text: string) => copied.push(text) },
    });
    render(
      createElement(PageTitleChrome, {
        pills: [],
        actions: [],
        catalogKey: 'service:scoreboard',
        summary: 'Shows the score.',
        children: createElement('h1', null, 'scoreboard'),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy page as Markdown' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(copied[0]).toContain('# scoreboard');
    expect(copied[0]).toContain('`service:scoreboard`');
    expect(copied[0]).toContain('Shows the score.');
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

describe('the home page', () => {
  const doc = (n: number) => ({
    id: `payments/doc-${n}`,
    repo: 'payments',
    title: `Document ${n}`,
    owner: 'Payments',
    updated: null,
    tags: [],
  });

  const failing = {
    needsReview: 0,
    needsReviewHref: '/catalog/?review=1',
    failures: [{ repository: 'billing', message: 'catalog.json does not parse' }],
    orphanProducers: 0,
    orphanConsumers: 0,
    unowned: 0,
    ownersHref: '/owners/',
    catalogHref: '/catalog/',
  };

  it('says which repository failed its scan beside where the facts come from', () => {
    render(
      createElement(HomeBlock, {
        id: 'home-provenance',
        block: {
          block: 'provenance',
          provenance: { resources: { declared: 3 }, relationships: {} },
          attention: failing,
        },
      }),
    );

    expect(screen.getByText('1 repository left out')).toBeTruthy();
    expect(screen.getByText('billing: catalog.json does not parse')).toBeTruthy();
  });

  it('still says what needs attention when there is nothing to count', () => {
    render(
      createElement(HomeBlock, {
        id: 'home-provenance',
        block: {
          block: 'provenance',
          provenance: { resources: {}, relationships: {} },
          attention: failing,
        },
      }),
    );

    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeTruthy();
    expect(screen.getByText('billing: catalog.json does not parse')).toBeTruthy();
  });

  it('searches on the site’s own search page when it has no search dialog', () => {
    render(
      createElement(HomeBlock, {
        id: 'home-search',
        block: { block: 'search', action: '/catalog/search' },
      }),
    );

    expect(screen.getByRole('search').getAttribute('action')).toBe('/catalog/search');
    expect(screen.getByRole('searchbox').getAttribute('name')).toBe('q');
  });

  it('keeps every document of a repository within reach', () => {
    const docs = Array.from({ length: 8 }, (_, n) => doc(n + 1));

    // The shelves are the `docs` block, which a layout names; the default home links to documents instead.
    render(
      createElement(HomeBlock, {
        id: 'home-documents',
        block: {
          block: 'docs',
          repos: [{ name: 'payments', label: 'Payments', href: '/payments/doc-1', docs }],
        },
      }),
    );

    for (const { title } of docs) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText('All 8 documents')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Payments' }).getAttribute('href')).toBe(
      '/payments/doc-1',
    );
  });
});

describe('Event page impact', () => {
  const page = (props: Partial<EventPageProps> = {}) =>
    render(
      createElement(EventPage, {
        owner: { team: 'Payments team', href: '/owners/payments/' },
        provenance: {
          method: 'extracted',
          location: 'src/events.ts:1',
          symbol: null,
          confidence: null,
          needsReview: false,
        },
        flow: eventFlow,
        schema,
        schemaHref: '/schema.json',
        evidence,
        examples: [],
        versions: [],
        documents: [],
        records: [
          {
            id: 'flows',
            heading: 'Flows',
            links: [{ href: '/flows/payments/checkout/', title: 'Checkout', label: 'payments' }],
          },
        ],
        facts: [['Id', 'payment.completed']],
        ...props,
      }),
    );

  const column = (name: string) =>
    within(document.querySelector<HTMLElement>(`[data-impact-column="${name}"]`) ?? document.body);

  it('links every producer, consumer, owner and flow, with counts', () => {
    page();

    expect(
      column('Producers')
        .getByRole('link', { name: /PaymentService/ })
        .getAttribute('href'),
    ).toBe('/services/PaymentService/');
    expect(
      column('Consumers')
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['LedgerService', 'AuditService']);
    expect(column('Consumers').getByText('2 services')).toBeTruthy();
    expect(
      column('Owner')
        .getByRole('link', { name: /Payments team/ })
        .getAttribute('href'),
    ).toBe('/owners/payments/');
    expect(
      column('Flows')
        .getByRole('link', { name: /Checkout/ })
        .getAttribute('href'),
    ).toBe('/flows/payments/checkout/');
  });

  it('says plainly when nothing consumes the event, and how to fix it', () => {
    page({ flow: { ...eventFlow, to: [] }, owner: undefined, records: [] });

    expect(column('Consumers').getByText('No consumers')).toBeTruthy();
    expect(column('Consumers').queryByRole('link')).toBeNull();
    expect(column('Owner').getByText('No owner')).toBeTruthy();
    expect(column('Flows').getByText('In no flows')).toBeTruthy();
  });

  // The left column of the grid holds the schema; the evidence card sits there only when empty.
  const besideSchema = () =>
    document.querySelector('#schema')?.closest('.grid > div')?.querySelector('#runtime') ?? null;

  it('keeps observed evidence beside the schema, and moves an empty card below it', () => {
    page();
    expect(besideSchema()).toBeNull();
    cleanup();

    page({ evidence: noEvidence });
    expect(besideSchema()).not.toBeNull();
  });
});

describe('Breadcrumbs', () => {
  it('lead from home through the domain to the page itself', () => {
    render(
      createElement(PageTitleChrome, {
        pills: [],
        actions: [],
        markdownActions: false,
        title: 'Payment requested',
        crumbs: [
          { label: 'Home', href: '/' },
          { label: 'Payments', href: '/domains/payments/' },
        ],
        children: createElement('h1', null, 'Payment requested'),
      }),
    );

    const trail = within(screen.getByRole('navigation', { name: 'breadcrumb' }));

    expect(
      trail.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Home', '/'],
      ['Payments', '/domains/payments/'],
      ['Payment requested', null],
    ]);
    expect(trail.getByText('Payment requested').getAttribute('aria-current')).toBe('page');
  });

  it('are left out when a page names none', () => {
    render(createElement(PageTitleChrome, { pills: [], actions: [] }));

    expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).toBeNull();
  });
});
