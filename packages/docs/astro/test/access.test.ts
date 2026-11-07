import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JsonValue } from 'autocatalog-core';
import { expect, it, vi } from 'vitest';
import { accessRule, defaultCanRead, readableCatalog, servedPath } from '../src/access';
import { accessTable, closedLinks, formatAccessTable } from '../src/access-report';
import { buildSiteCatalog } from '../src/catalog';
import { docsSiteConfig } from '../src/config';

const doc = (access?: JsonValue) => ({
  id: 'help/guide',
  data: { title: 'Guide', ...(access !== undefined && { access }) },
});

it('opens a document when the reader holds everything it lists', () => {
  const lakeview = { access: ['invoicing'] };

  expect(defaultCanRead(doc(), undefined)).toBe(true);
  expect(defaultCanRead(doc(['invoicing']), lakeview)).toBe(true);
  expect(defaultCanRead(doc('invoicing'), lakeview)).toBe(true);
  expect(defaultCanRead(doc(['invoicing', 'payments']), lakeview)).toBe(false);
  expect(defaultCanRead(doc(['invoicing']), undefined)).toBe(false);
});

it('keeps a document closed when its access cannot be read, or the rule throws', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(defaultCanRead(doc({ plan: 'pro' }), { access: ['pro'] })).toBe(false);

  const canRead = accessRule(
    {
      reader: () => undefined,
      canRead: () => {
        throw new Error('session store down');
      },
    },
    undefined,
  );

  expect(canRead(doc())).toBe(false);
});

it('matches paths as docHref writes them', () => {
  expect(servedPath('/help/help-centre/get%2Dpaid/')).toBe('/help/help-centre/get-paid');
  expect(servedPath('/help/%E0%A4%A')).toBe('/help/%E0%A4%A');
});

it('lists only the documents a reader may open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-access-'));

  try {
    const write = async (file: string, body: string) => {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), body);
    };

    await write('help/docs/open.md', '---\ntitle: Open\nowner: support\n---\n');
    await write('help/docs/paid.md', '---\ntitle: Paid\nowner: support\naccess: [payments]\n---\n');

    const catalog = await buildSiteCatalog({ ...docsSiteConfig(), root });
    const readable = readableCatalog(catalog, accessRule({ reader: () => undefined }, undefined));

    expect(readable.docs.map((each) => each.id)).toEqual(['help/open']);
    expect(Object.keys(readable.manifest)).toEqual(['help/open']);
    expect(readableCatalog(catalog, undefined)).toBe(catalog);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const page = (id: string, data: Record<string, JsonValue>, body = '') => ({
  id,
  repo: id.split('/')[0]!,
  file: `${id}.md`,
  data: { title: id, ...data },
  body,
});

it('says what each sample reader may open, and which links lead one to a closed document', () => {
  const docs = [
    page('help/start', {}, 'See [getting paid](/help/payments/paid) and [invoices](./invoices/).'),
    page('help/invoices/index', { access: ['invoicing'] }, '[Paid](../payments/paid.md)'),
    page('help/payments/paid', { access: ['payments'] }),
  ];

  const table = accessTable(docs, {
    reader: () => undefined,
    readers: {
      Lakeview: { access: ['invoicing'] },
      Riverside: { access: ['invoicing', 'payments'] },
    },
  });

  expect(table.readers).toEqual(['signed out', 'Lakeview', 'Riverside']);
  expect(table.rows.map((row) => row.opens)).toEqual([
    [true, true, true],
    [false, true, true],
    [false, false, true],
  ]);
  expect(formatAccessTable(table).split('\n')[0]).toMatch(
    /^document\s+signed out {2}Lakeview {2}Riverside$/,
  );

  expect(closedLinks(docs, table)).toEqual([
    'help/start links to help/payments/paid, which signed out, Lakeview may not open',
    'help/start links to help/invoices/index, which signed out may not open',
    'help/invoices/index links to help/payments/paid, which Lakeview may not open',
  ]);
});

it('counts what each reader opens once the table would be too long to read', () => {
  const docs = Array.from({ length: 41 }, (_, i) =>
    page(`help/guide-${i}`, i < 30 ? {} : { access: ['payments'] }),
  );

  const table = accessTable(docs, {
    reader: () => undefined,
    readers: { Riverside: { access: ['payments'] } },
  });

  expect(formatAccessTable(table)).toBe(
    'signed out: 30 of 41 documents\nRiverside: 41 of 41 documents',
  );
});
