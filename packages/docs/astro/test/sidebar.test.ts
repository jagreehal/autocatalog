import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { docPaths } from '../src/paths';
import { catalogSidebar, docsSidebar, navigationGroups, titleCase } from '../src/sidebar';
import { docHref } from '../src/ui/lib/docs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-sidebar-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const doc = (title: string): string => `---\ntitle: ${title}\nowner: Payments\n---\n\nBody.\n`;

describe('navigationGroups', () => {
  const pages = [
    { label: 'Knowledge graph', link: '/catalog' },
    { label: 'Owners', link: '/owners' },
    { label: 'Domains', link: '/domains' },
  ];

  it('draws each catalog page with its icon, as an SVG the stylesheet paints', () => {
    const [group] = navigationGroups([{ label: 'Services', link: '/services', icon: 'service' }]);
    const link = group!.items[0]!;

    expect(link).toMatchObject({ label: 'Services', link: '/services' });
    expect('attrs' in link && link.attrs?.['data-icon']).toBe('service');
    expect('attrs' in link && link.attrs?.style).toMatch(
      /^--ac-icon: url\("data:image\/svg\+xml,%3Csvg/,
    );
  });

  it('keeps the catalog group when nothing is configured', () => {
    expect(navigationGroups(pages)).toEqual([{ label: 'Catalog', items: pages }]);
    expect(navigationGroups([])).toEqual([]);
  });

  it('replaces it with the groups a site names, in their order, with its own links', () => {
    expect(
      navigationGroups(pages, {
        groups: [
          { label: 'People', items: [{ id: 'owners' }] },
          {
            label: 'Browse',
            collapsed: true,
            items: [
              { id: 'catalog', label: 'Everything' },
              { label: 'Status', href: 'https://status.example.com' },
            ],
          },
        ],
      }),
    ).toEqual([
      { label: 'People', items: [{ label: 'Owners', link: '/owners' }] },
      {
        label: 'Browse',
        collapsed: true,
        items: [
          { label: 'Everything', link: '/catalog' },
          { label: 'Status', link: 'https://status.example.com' },
        ],
      },
    ]);
  });

  it('finds a page by the id a site names it by, wherever its link goes', () => {
    const apis = { label: 'API reference', id: 'apis', link: '/apis/payments/openapi/' };

    expect(
      navigationGroups([apis], { groups: [{ label: 'Developers', items: [{ id: 'apis' }] }] }),
    ).toEqual([
      { label: 'Developers', items: [{ label: 'API reference', link: '/apis/payments/openapi/' }] },
    ]);
    expect(navigationGroups([apis])).toEqual([
      { label: 'Catalog', items: [{ label: 'API reference', link: '/apis/payments/openapi/' }] },
    ]);
  });

  it('leaves out a page this catalog has nothing for, and a group left empty', () => {
    expect(
      navigationGroups(pages, {
        groups: [
          { label: 'Empty', items: [{ id: 'flows' }] },
          { label: 'Browse', items: [{ id: 'flows' }, { id: 'domains' }] },
        ],
      }),
    ).toEqual([{ label: 'Browse', items: [{ label: 'Domains', link: '/domains' }] }]);
  });
});

describe('docsSidebar', () => {
  it('groups by repository, in name order, with each document titled', async () => {
    await write('reporter/docs/daily.md', doc('Daily reconciliation'));
    await write('payments-service/docs/runbook.md', doc('Runbook'));
    await write('payments-service/docs/ops/replay.md', doc('Replaying captures'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'payments-service',
        collapsed: true,
        items: [
          { label: 'Runbook', link: '/payments-service/runbook' },
          {
            label: 'Ops',
            collapsed: true,
            items: [{ label: 'Replaying captures', link: '/payments-service/ops/replay' }],
          },
        ],
      },
      {
        label: 'reporter',
        collapsed: true,
        items: [{ label: 'Daily reconciliation', link: '/reporter/daily' }],
      },
    ]);
  });

  it('opens with an index document, called Overview, at its folder', async () => {
    await write('payments/docs/a.md', doc('A'));
    await write('payments/docs/index.md', doc('Payments'));
    await write('payments/docs/guide/index.md', doc('Guide'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'payments',
        items: [
          { label: 'Overview', link: '/payments' },
          { label: 'A', link: '/payments/a' },
          { label: 'Guide', collapsed: true, items: [{ label: 'Guide', link: '/payments/guide' }] },
        ],
      },
    ]);
    expect(docHref('payments/index')).toBe('/payments');
  });

  it('nests a folder in a folder, with the labels meta.json gives each', async () => {
    await write(
      'help/docs/meta.json',
      JSON.stringify({
        label: 'Help',
        sidebar: [
          { directory: 'labels', label: 'For labels' },
          { directory: 'labels/faqs', label: 'FAQs' },
        ],
      }),
    );
    await write('help/docs/labels/start.md', doc('Start'));
    await write('help/docs/labels/faqs/refunds.md', doc('Refunds'));
    await write('help/docs/labels/sales/upload.md', doc('Upload'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'Help',
        items: [
          {
            label: 'For labels',
            collapsed: false,
            items: [
              { label: 'Start', link: '/help/labels/start' },
              {
                label: 'FAQs',
                collapsed: false,
                items: [{ label: 'Refunds', link: '/help/labels/faqs/refunds' }],
              },
              {
                label: 'Sales',
                collapsed: true,
                items: [{ label: 'Upload', link: '/help/labels/sales/upload' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('takes the name and folder order a repository gives in docs/meta.json', async () => {
    await write(
      'tools/docs/meta.json',
      JSON.stringify({
        label: 'Internal Tools',
        sidebar: [
          { directory: 'runbooks', label: 'Runbooks', collapsed: true },
          { directory: 'guide', label: 'Start here' },
        ],
      }),
    );
    await write('tools/docs/guide/start.md', doc('Start'));
    await write('tools/docs/runbooks/restart.md', doc('Restart'));
    await write('tools/docs/stories/user-stories.md', doc('Stories'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'Internal Tools',
        items: [
          {
            label: 'Runbooks',
            collapsed: true,
            items: [{ label: 'Restart', link: '/tools/runbooks/restart' }],
          },
          {
            label: 'Start here',
            collapsed: false,
            items: [{ label: 'Start', link: '/tools/guide/start' }],
          },
          // A folder nobody listed is never hidden for want of a label.
          {
            label: 'Stories',
            collapsed: true,
            items: [{ label: 'Stories', link: '/tools/stories/user-stories' }],
          },
        ],
      },
    ]);
  });

  it("publishes an index document's twin at its page's address too", async () => {
    await write('payments/docs/index.md', doc('Payments'));
    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);

    expect(docPaths().map(({ params }) => params.slug)).toEqual(['payments/index', 'payments']);
    vi.unstubAllEnvs();
  });

  it('still lists a document with no usable title, so it can be navigated to and fixed', async () => {
    await write('a/docs/broken.md', '---\nowner: Ops\n---\n\nNo title.\n');

    expect(docsSidebar(root)).toEqual([
      { label: 'a', items: [{ label: 'a/broken', link: '/a/broken' }] },
    ]);
  });

  it("honours Starlight's sidebar order, label and hidden frontmatter", async () => {
    const withSidebar = (title: string, sidebar: string) =>
      `---\ntitle: ${title}\nowner: Payments\nsidebar:\n${sidebar}\n---\n\nBody.\n`;

    await write('a/docs/alpha.md', doc('Alpha'));
    await write('a/docs/beta.md', withSidebar('Beta', '  order: 2'));
    await write('a/docs/gamma.md', withSidebar('Gamma', '  order: 1\n  label: Start here'));
    await write('a/docs/draft.md', withSidebar('Draft', '  hidden: true'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'a',
        items: [
          { label: 'Start here', link: '/a/gamma' },
          { label: 'Beta', link: '/a/beta' },
          { label: 'Alpha', link: '/a/alpha' },
        ],
      },
    ]);
  });

  it('reads the single-repository shape too', async () => {
    await write('docs/runbook.md', doc('Runbook'));

    expect(docsSidebar(root, { repo: 'payments-service' })).toEqual([
      {
        label: 'payments-service',
        items: [{ label: 'Runbook', link: '/payments-service/runbook' }],
      },
    ]);
  });

  it('leaves out a package the catalog quarantines for sharing the root identity', async () => {
    await write('package.json', '{}');
    await write('docs/workspace.md', doc('Workspace'));
    await write('services/orders/package.json', '{}');
    await write('services/orders/docs/index.md', doc('Orders'));
    const options = { repo: 'platform', repository: 'orders' };

    const catalog = await buildDocsCatalog(root, { ...options, includeDates: false });

    expect(catalog.docs.map(({ id }) => id)).toEqual(['platform/workspace']);
    expect(
      docsSidebar(root, options).flatMap(({ items }) =>
        items.map((item) => ('link' in item ? item.link : item.label)),
      ),
    ).toEqual(['/platform/workspace']);
  });

  it('returns nothing when no repository has enrolled yet', () => {
    expect(docsSidebar(root)).toEqual([]);
  });
});

describe('catalogSidebar', () => {
  const manifest = (id: string, domain: string, producers: string[], consumers: string[]) =>
    JSON.stringify({
      spec: 'autocatalog/v2',
      id,
      version: '1.0.0',
      name: id,
      summary: `${id} happened.`,
      domain,
      producers,
      consumers,
      schema: 'schema.json',
    });

  async function publish(folder: string, body: string): Promise<void> {
    await write(`${folder}/autocatalog.json`, body);
    await write(`${folder}/schema.json`, JSON.stringify({ type: 'object' }));
  }

  it('groups validated events by domain under the domain’s overview, links each to its namespaced page, and lists services', async () => {
    await publish(
      'payments-service/events/payments/Captured',
      manifest('payment.captured', 'payments', ['PaymentService'], ['LedgerService']),
    );
    await publish(
      'orders-service/events/orders/Placed',
      manifest('order.placed', 'orders', ['OrderService'], ['PaymentService']),
    );

    const { events } = await buildDocsCatalog(root, { includeDates: false });

    expect(catalogSidebar(events)).toEqual([
      {
        collapsed: true,
        label: 'Events · orders',
        items: [
          { label: 'Overview', link: '/domains/orders/' },
          { label: 'order.placed', link: '/events/orders-service/orders/order.placed/' },
        ],
      },
      {
        collapsed: true,
        label: 'Events · payments',
        items: [
          { label: 'Overview', link: '/domains/payments/' },
          {
            label: 'payment.captured',
            link: '/events/payments-service/payments/payment.captured/',
          },
        ],
      },
      {
        label: 'Services',
        collapsed: false,
        items: ['LedgerService', 'OrderService', 'PaymentService'].map((name) => ({
          label: name,
          link: `/services/${name}/`,
        })),
      },
    ]);
  });

  it('leaves out a repository whose manifest is not even valid JSON, instead of failing', async () => {
    await publish(
      'payments-service/events/payments/Captured',
      manifest('payment.captured', 'payments', ['PaymentService'], []),
    );
    await write('broken-service/events/broken/Nope/autocatalog.json', '{ this is not json');

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures.map((f) => f.repository)).toEqual(['broken-service']);

    const links = catalogSidebar(catalog.events).flatMap((group) =>
      group.items.flatMap((i) => ('link' in i ? [i.link] : [])),
    );

    expect(links).toContain('/events/payments-service/payments/payment.captured/');
    expect(links.some((link) => link.includes('broken'))).toBe(false);
  });

  it('gives the same event id from two repositories two separate pages', async () => {
    await publish(
      'payments-service/events/payments/Completed',
      manifest('payment.completed', 'payments', ['PaymentService'], []),
    );
    await publish(
      'legacy-billing/events/billing/Completed',
      manifest('payment.completed', 'billing', ['BillingService'], []),
    );

    const { events } = await buildDocsCatalog(root, { includeDates: false });

    const links = catalogSidebar(events).flatMap((group) =>
      group.items.flatMap((i) => ('link' in i ? [i.link] : [])),
    );

    expect(links).toEqual(
      expect.arrayContaining([
        '/events/payments-service/payments/payment.completed/',
        '/events/legacy-billing/billing/payment.completed/',
      ]),
    );
  });

  it('adds nothing when no repository publishes events or an API', () => {
    expect(catalogSidebar([])).toEqual([]);
  });

  it('lists the services OpenAPI specs serve, each with its page and its Scalar reference', () => {
    const api = (repository: string, services: string[], title = repository) => ({
      repository,
      name: 'openapi',
      file: 'contracts/openapi.json',
      document: { openapi: '3.1.0', info: { title, version: '1' }, paths: {} },
      services,
    });

    expect(
      catalogSidebar(
        [],
        [api('orders-api', ['orders-api'], 'Orders API'), api('users-api', ['users-api'])],
      ),
    ).toEqual([
      {
        label: 'Services',
        collapsed: false,
        items: [
          {
            label: 'orders-api',
            collapsed: true,
            items: [
              { label: 'Overview', link: '/services/orders-api/' },
              { label: 'Scalar', link: '/apis/orders-api/openapi/' },
            ],
          },
          {
            label: 'users-api',
            collapsed: true,
            items: [
              { label: 'Overview', link: '/services/users-api/' },
              { label: 'Scalar', link: '/apis/users-api/openapi/' },
            ],
          },
        ],
      },
    ]);
  });

  it('names the reference link as a site says, and each one by its API when a service has two', () => {
    const api = (name: string, title: string) => ({
      repository: 'billing',
      name,
      file: `contracts/${name}.json`,
      document: { openapi: '3.1.0', info: { title, version: '1' }, paths: {} },
      services: ['billing'],
    });

    const [services] = catalogSidebar(
      [],
      [api('invoices', 'Invoices API'), api('refunds', 'Refunds API')],
      { apiLabel: 'API reference' },
    );

    expect(services!.items[0]).toMatchObject({
      label: 'billing',
      items: [
        { label: 'Overview' },
        { label: 'API reference: Invoices API', link: '/apis/billing/invoices/' },
        { label: 'API reference: Refunds API', link: '/apis/billing/refunds/' },
      ],
    });
  });
});

describe('a folder with no label of its own', () => {
  it('reads as words, with its acronyms in capitals', () => {
    expect(['it', 'hr', 'on-call', 'faqs', 'api_guides', 'people'].map(titleCase)).toEqual([
      'IT',
      'HR',
      'On Call',
      'FAQs',
      'API Guides',
      'People',
    ]);
  });
});
