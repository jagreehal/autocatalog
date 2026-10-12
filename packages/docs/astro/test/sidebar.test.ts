import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { catalogSidebar, docsSidebar } from '../src/sidebar';

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

describe('docsSidebar', () => {
  it('groups by repository, in name order, with each document titled', async () => {
    await write('reporter/docs/daily.md', doc('Daily reconciliation'));
    await write('payments-service/docs/runbook.md', doc('Runbook'));
    await write('payments-service/docs/ops/replay.md', doc('Replaying captures'));

    expect(docsSidebar(root)).toEqual([
      {
        label: 'payments-service',
        items: [
          { label: 'Replaying captures', link: '/payments-service/ops/replay' },
          { label: 'Runbook', link: '/payments-service/runbook' },
        ],
      },
      { label: 'reporter', items: [{ label: 'Daily reconciliation', link: '/reporter/daily' }] },
    ]);
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

    expect(docsSidebar(root, 'payments-service')).toEqual([
      {
        label: 'payments-service',
        items: [{ label: 'Runbook', link: '/payments-service/runbook' }],
      },
    ]);
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

  it('groups validated events by domain, links each to its namespaced page, and lists services', async () => {
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
        label: 'Events · orders',
        items: [{ label: 'order.placed', link: '/events/orders-service/orders/order.placed/' }],
      },
      {
        label: 'Events · payments',
        items: [
          {
            label: 'payment.captured',
            link: '/events/payments-service/payments/payment.captured/',
          },
        ],
      },
      {
        label: 'Services',
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
    const links = catalogSidebar(catalog.events).flatMap((group) => group.items.map((i) => i.link));
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
    const links = catalogSidebar(events).flatMap((group) => group.items.map((i) => i.link));

    expect(links).toEqual(
      expect.arrayContaining([
        '/events/payments-service/payments/payment.completed/',
        '/events/legacy-billing/billing/payment.completed/',
      ]),
    );
  });

  it('adds nothing when no repository publishes events', () => {
    expect(catalogSidebar([])).toEqual([]);
  });
});
