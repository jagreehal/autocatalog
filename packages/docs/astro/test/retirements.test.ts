import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { retirementsPageProps } from '../src/retirements';
import { RetirementsPage } from '../src/ui/pages/RetirementsPage';

describe('retirementsPageProps', () => {
  it('lists each deprecated field with every consumer the company declares', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-retirements-'));

    try {
      const event = path.join(root, 'shop/events/orders/Placed');
      await fs.mkdir(event, { recursive: true });
      await fs.writeFile(
        path.join(event, 'autocatalog.json'),
        JSON.stringify({
          spec: 'autocatalog/v2',
          id: 'order.placed',
          version: '1.0.0',
          name: 'Order placed',
          summary: 'An order was placed.',
          domain: 'orders',
          producers: ['Order Service'],
          consumers: ['Ledger', 'Billing'],
          consumerFields: { Ledger: ['total'], Billing: ['id'] },
          schema: 'schema.json',
        }),
      );
      await fs.writeFile(
        path.join(event, 'schema.json'),
        JSON.stringify({
          type: 'object',
          properties: { id: { type: 'string' }, total: { type: 'number', deprecated: true } },
        }),
      );
      // Billing's own word outranks what the producer wrote down for it.
      await fs.mkdir(path.join(root, 'billing'));
      await fs.writeFile(
        path.join(root, 'billing/autocatalog.consumes.json'),
        JSON.stringify({
          consumes: [{ service: 'Billing', event: 'orders/order.placed', fields: ['total'] }],
        }),
      );
      await fs.mkdir(path.join(root, 'fraud'));
      await fs.writeFile(
        path.join(root, 'fraud/autocatalog.consumes.json'),
        JSON.stringify({ consumes: [{ service: 'Fraud', event: 'orders/order.placed' }] }),
      );

      const catalog = await buildDocsCatalog(root, { includeDates: false });
      const { retirements } = retirementsPageProps(catalog, '/');

      expect(
        retirements.map((r) => [
          r.field,
          r.verdict,
          r.consumers.map((c) => `${c.consumer} ${c.standing}`),
        ]),
      ).toEqual([['total', 'blocked', ['Billing reads', 'Ledger reads', 'Fraud unspecified']]]);

      // Fraud declares itself only in its own repository, so it has a Catalog row, not a page.
      expect(retirements[0]!.consumers.map((c) => c.href)).toEqual([
        '/services/Billing/',
        '/services/Ledger/',
        expect.stringMatching(/^\/catalog\/#/),
      ]);

      const html = renderToStaticMarkup(createElement(RetirementsPage, { retirements }));

      expect(html).toContain('Blocked');
      expect(html).toContain('Ledger moves off total');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
