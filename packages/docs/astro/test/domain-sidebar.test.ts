import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { domainSidebar } from '../src/domain-sidebar';
import { buildDomains } from '../src/domains';
import { domainsPageProps } from '../src/page-models';
import type { SidebarGroup, SidebarLink } from '../src/sidebar';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-domain-sidebar-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

async function publish(repository: string, id: string, domain: string, producer: string) {
  const folder = `${repository}/events/${domain}/${id}`;

  await write(
    `${folder}/autocatalog.json`,
    JSON.stringify({
      spec: 'autocatalog/v2',
      id,
      version: '1.0.0',
      name: id,
      summary: `${id} happened.`,
      domain,
      producers: [producer],
      consumers: [],
      schema: 'schema.json',
    }),
  );
  await write(`${folder}/schema.json`, JSON.stringify({ type: 'object' }));
}

const pages: SidebarLink[] = [
  { label: 'Knowledge graph', link: '/catalog', icon: 'catalog' },
  { label: 'Domains', link: '/domains', icon: 'domain' },
  { label: 'Schemas', link: '/schemas', icon: 'braces' },
  { label: 'Services', link: '/services', icon: 'service' },
  { label: 'Owners', link: '/owners', icon: 'owners' },
];

/** A sidebar as labels, groups as `label: [children]`, for reading at a glance. */
const labelTree = (items: Array<SidebarLink | SidebarGroup>): unknown[] =>
  items.map((item) => ('items' in item ? { [item.label]: labelTree(item.items) } : item.label));

it('opens with Domains, subdomains inside their parent, then a link to each catalog page', async () => {
  await publish('fulfilment-service', 'order.packed', 'fulfilment', 'Warehouse');
  await publish('fulfilment-service', 'return.requested', 'returns', 'Returns API');
  await publish('payments-service', 'payment.captured', 'payments', 'Payment Worker');
  await write(
    'fulfilment-service/overviews/domains/returns.md',
    '---\nname: Returns\nparent: fulfilment\n---\n\nTaking things back.\n',
  );
  await write('payments-service/overviews/domains/payments.md', '---\nname: Payments\n---\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(labelTree(domainSidebar(catalog, pages))).toEqual([
    {
      Domains: [
        {
          Fulfilment: [
            'Overview',
            {
              Returns: [
                'Overview',
                { Services: ['Returns API'] },
                { Events: ['return.requested'] },
              ],
            },
            { Services: ['Warehouse'] },
            { Events: ['order.packed'] },
          ],
        },
        {
          Payments: [
            'Overview',
            { Services: ['Payment Worker'] },
            { Events: ['payment.captured'] },
          ],
        },
      ],
    },
    { Catalog: ['Knowledge graph', 'Domains', 'Schemas', 'Services', 'Owners'] },
  ]);
});

it("lists a domain's commands and queries, which open the Catalog on them", async () => {
  await publish('payments-service', 'payment.captured', 'payments', 'Payment Worker');

  const command = (id: string, title: string, tags: string[]) => ({
    ref: { kind: 'command', namespace: 'payments', id, version: '1.0.0' },
    title,
    tags,
    provenance: { default: 'declared', fields: {} },
    needsReview: false,
    attributes: {},
  });

  await write(
    'payments-service/.autocatalog/resources.json',
    JSON.stringify({
      spec: 'autocatalog/graph-v1',
      resources: [
        command('refund-payment', 'Refund payment', []),
        command('get-payment', 'Get payment', ['query']),
      ],
      relationships: [],
    }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  const [domains] = domainSidebar(catalog, pages);
  const [payments] = domains!.items;

  const commands = (payments && 'items' in payments ? payments.items : []).find(
    (item): item is SidebarGroup => 'items' in item && item.label === 'Commands',
  );

  expect(commands?.items.map((item) => [item.label, 'link' in item ? item.link : ''])).toEqual([
    ['Get payment', '/catalog/?kind=command&q=get-payment'],
    ['Refund payment', '/catalog/?kind=command&q=refund-payment'],
  ]);
});

it('keeps the first of two repositories that describe one domain, and says so', async () => {
  await publish('fulfilment-service', 'order.packed', 'fulfilment', 'Warehouse');
  await write(
    'a-handbook/overviews/domains/fulfilment.md',
    '---\nname: Fulfilment\n---\n\nFirst.\n',
  );
  await write(
    'fulfilment-service/overviews/domains/fulfilment.md',
    '---\nname: Shipping\n---\n\nSecond.\n',
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.overviews.map(({ repository, name }) => [repository, name])).toEqual([
    ['a-handbook', 'Fulfilment'],
  ]);
  expect(catalog.warnings).toContain(
    "fulfilment-service/overviews/domains/fulfilment.md: domain 'fulfilment' already has an overview in a-handbook/overviews/domains/fulfilment.md, so it is left out",
  );
});

it('gives a domain only services name its page, sidebar entry and overview', async () => {
  await publish('payments-service', 'payment.captured', 'payments', 'Payment Worker');
  await write(
    'ledger/.autocatalog/resources.json',
    JSON.stringify({
      spec: 'autocatalog/graph-v1',
      resources: [
        {
          ref: { kind: 'service', id: 'Ledger Exporter' },
          title: 'Ledger Exporter',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domains: ['ledger'] },
          owner: { team: 'finance' },
        },
      ],
      relationships: [],
    }),
  );
  await write('ledger/overviews/domains/ledger.md', '---\nname: Ledger\n---\n\nThe books.\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.warnings.filter((warning) => warning.includes('ledger'))).toEqual([]);
  expect(buildDomains(catalog.events, catalog.graph).find(({ name }) => name === 'ledger')).toEqual(
    {
      name: 'ledger',
      events: [],
      services: ['Ledger Exporter'],
      owners: ['finance'],
    },
  );
  expect(domainsPageProps(catalog, '/').domains.map(({ name }) => name)).toEqual([
    'ledger',
    'payments',
  ]);

  const [domains] = domainSidebar(catalog, pages);

  expect(labelTree(domains!.items)).toContainEqual({
    Ledger: ['Overview', { Services: ['Ledger Exporter'] }],
  });
});

it('links every page the catalog has, so no feature drops out of the sidebar', async () => {
  await publish('payments-service', 'payment.captured', 'payments', 'Payment Worker');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  const every: SidebarLink[] = [
    ...pages,
    { label: 'MCP servers', link: '/mcp-servers', icon: 'mcp-server' },
    { label: 'Glossary', link: '/glossary', icon: 'glossary' },
    { label: 'APIs', link: '/apis', icon: 'api' },
  ];

  const hrefs = (items: Array<SidebarLink | SidebarGroup>): string[] =>
    items.flatMap((item) => ('items' in item ? hrefs(item.items) : [item.link]));

  const linked = hrefs(domainSidebar(catalog, every));

  for (const page of every) expect(linked).toContain(page.link);
});

it('gives Starlight links with their icons drawn, not named', async () => {
  await publish('payments-service', 'payment.captured', 'payments', 'Payment Worker');

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const [, pagesGroup] = domainSidebar(catalog, pages);
  const link = pagesGroup!.items[0]!;

  expect(link).not.toHaveProperty('icon');
  expect('attrs' in link && link.attrs?.['data-icon']).toBe('catalog');
});

it('leaves a catalog without domains to its list of pages', async () => {
  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(domainSidebar(catalog, pages)).toEqual([]);
});
