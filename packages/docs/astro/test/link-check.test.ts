import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { brokenLinks } from '../src/link-check';

let out: string;

beforeEach(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-links-'));
});

afterEach(async () => {
  await fs.rm(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(out, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

it('reports internal links and anchors with nothing behind them, under the base', async () => {
  await write(
    'payments-service/runbook/index.html',
    [
      '<h2 id="replay">Replay</h2>',
      '<a href="/docs/payments-service/runbook/#replay">ok anchor</a>',
      '<a href="#missing">bad anchor</a>',
      '<a href="/docs/events/payments-service/payments/payment.captured/">ok event</a>',
      '<a href="/docs/services/Gone/">bad service</a>',
      '<a href="/docs/events/payments-service/payments/payment.captured/schema.json">ok file</a>',
      '<a href="../renamed/">bad body link</a>',
      '<a href="https://example.test/elsewhere">external</a>',
      '<a href="/not-this-site/">outside the base</a>',
      '<script>const a = \'<a href="/docs/in-a-script/">\';</script>',
    ].join('\n'),
  );
  await write('events/payments-service/payments/payment.captured/index.html', '<h1>Captured</h1>');
  await write('events/payments-service/payments/payment.captured/schema.json', '{}');

  expect(await brokenLinks(out, '/docs/')).toEqual([
    { page: '/docs/payments-service/runbook/', href: '#missing', kind: 'anchor' },
    { page: '/docs/payments-service/runbook/', href: '/docs/services/Gone/', kind: 'page' },
    { page: '/docs/payments-service/runbook/', href: '../renamed/', kind: 'page' },
  ]);
});

it('finds nothing to report in a site whose links all resolve', async () => {
  await write(
    'index.html',
    '<a href="/catalog/">Catalog</a><a href="/catalog/#_top">Top</a><a href="/catalog#resource-a%3Ab">Raw</a><a href="/catalog/#h%C3%A9">Decoded</a>',
  );
  await write(
    'catalog/index.html',
    '<span id="_top"></span><li id="resource-a%3Ab"></li><h2 id="hé"></h2>',
  );

  expect(await brokenLinks(out)).toEqual([]);
});

it('ignores links inside HTML comments', async () => {
  await write('index.html', '<!-- <a href="/removed/">old</a> -->\n<h1>Home</h1>');

  expect(await brokenLinks(out)).toEqual([]);
});

it('accepts #top, which browsers resolve without an element', async () => {
  await write('index.html', '<a href="#top">Back to top</a>\n<a href="/#TOP">Top</a>');

  expect(await brokenLinks(out)).toEqual([]);
});

it("leaves EventCatalog's output to EventCatalog: links into it, and links inside it", async () => {
  await write(
    'events/payments/index.html',
    '<a href="/docs/eventcatalog/visualiser/events/payment.captured/1.0.0/">Open the diagram</a>',
  );
  await write(
    'eventcatalog/visualiser/graph/index.html',
    '<a href="/docs/eventcatalog/gone/">x</a>',
  );

  expect(await brokenLinks(out, '/docs/')).toEqual([]);
});
