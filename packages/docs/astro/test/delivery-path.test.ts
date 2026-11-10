import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocsCatalog, type DocsCatalog } from '../src/catalog';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliveryPathView, servicePages } from '../src/page-models';
import { withNames } from '../src/ui/components/DeliveryPath';

const example = fileURLToPath(new URL('../../../../examples/federation', import.meta.url));

let root: string;

let catalog: DocsCatalog;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-delivery-path-'));

  // The broker, the event and the consumer from three repositories.
  for (const team of ['infra', 'payments', 'ledger'])
    await fs.cp(path.join(example, team), path.join(root, team), { recursive: true });

  catalog = await buildDocsCatalog(root, { includeDates: false });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('deliveryPathView', () => {
  it('links each service to its page, one only the graph declares included', () => {
    const view = deliveryPathView(
      catalog.delivery,
      'payments/payment.completed',
      '/',
      servicePages(catalog),
    );

    const services = view!.routes
      .flatMap((route) => route.hops)
      .flatMap((hop) => (hop.entity === 'service' ? [[hop.name, hop.href]] : []));

    // LedgerService is declared only in ledger's autocatalog.consumes.json.
    // The graph holds it, so it has a page like any other service.
    expect(Object.fromEntries(services)).toEqual({
      PaymentService: '/services/PaymentService/',
      LedgerService: '/services/LedgerService/',
    });
  });
});

describe('withNames', () => {
  it('shows each quoted name as code, and the rest as text', () => {
    const html = renderToStaticMarkup(
      createElement(
        'p',
        null,
        withNames('`LedgerService` reads from `ledger.payments`, and `` a`b `` too'),
      ),
    );

    expect(html).toBe(
      '<p><code>LedgerService</code> reads from <code>ledger.payments</code>, and <code>a`b</code> too</p>',
    );
  });
});
