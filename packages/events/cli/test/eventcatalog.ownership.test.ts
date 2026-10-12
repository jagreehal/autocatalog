import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import utils from '@eventcatalog/sdk';
import type { JsonObject } from 'autocatalog-core';
import { exportToEventCatalog, loadEventCatalogSources } from '../src/eventcatalog';

/** The CLI's path: load each `events/` root, then export them. */
const exportRoots = async ({
  roots,
  ...rest
}: {
  roots: string[];
  catalogDir: string;
  narrative?: boolean;
}) => exportToEventCatalog({ catalogs: await loadEventCatalogSources(roots), ...rest });

const here = path.dirname(fileURLToPath(import.meta.url));

// payment.completed 1.0.0, with 0.9.0 in its history, in the payments domain.
const starter = path.resolve(here, '../../../../fixtures/event-starter/events');

let catalog: string;

beforeEach(async () => {
  catalog = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-ownership-'));
});

afterEach(() => fs.rm(catalog, { recursive: true, force: true }));

const exportStarter = () => exportRoots({ roots: [starter], catalogDir: catalog });

async function writeFile(rel: string, body: string): Promise<void> {
  const file = path.join(catalog, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

const exists = (rel: string) =>
  fs.stat(path.join(catalog, rel)).then(
    () => true,
    () => false,
  );

describe('to-eventcatalog leaves what it did not write alone', () => {
  it('keeps a hand-written domain, its services and its assets, across repeated exports', async () => {
    await writeFile(
      'domains/payments/index.mdx',
      '---\nid: payments\nname: Payments (ours)\nversion: 2.0.0\n---\n\nWritten by the payments team.\n',
    );
    await writeFile(
      'domains/payments/services/Refunds/index.mdx',
      '---\nid: Refunds\nname: Refunds\nversion: 1.0.0\n---\n\nHand-written.\n',
    );
    await writeFile('domains/payments/diagram.png', 'not really a png');

    const first = await exportStarter();
    await exportStarter();

    const domain = await fs.readFile(path.join(catalog, 'domains/payments/index.mdx'), 'utf8');
    expect(domain).toContain('Written by the payments team.');
    expect(domain).not.toContain('x-autocatalog');
    expect(await exists('domains/payments/services/Refunds/index.mdx')).toBe(true);
    expect(await exists('domains/payments/diagram.png')).toBe(true);
    expect(first.skipped).toContain(
      'domain payments exists and was not written by autocatalog; left as it is',
    );
    // autocatalog's own event still lands inside it.
    expect(await utils(catalog).getEvent('payment.completed')).toBeDefined();
  });

  it('keeps a hand-written service placed inside a domain autocatalog owns', async () => {
    await exportStarter();
    await writeFile(
      'domains/payments/services/Fraud/index.mdx',
      '---\nid: Fraud\nname: Fraud\nversion: 1.0.0\n---\n\nHand-written.\n',
    );

    await exportStarter();

    expect(await exists('domains/payments/services/Fraud/index.mdx')).toBe(true);
    expect(await exists('domains/payments/index.mdx')).toBe(true);
  });

  it('does not overwrite a hand-written event or team with the same id, and says so', async () => {
    await writeFile(
      'events/payment.completed/index.mdx',
      '---\nid: payment.completed\nname: Ours\nversion: 9.9.9\n---\n\nHand-written.\n',
    );
    await writeFile(
      'teams/payments.mdx',
      '---\nid: payments\nname: Payments\n---\n\nThe real team page.\n',
    );

    const result = await exportStarter();

    const event = await utils(catalog).getEvent('payment.completed');
    expect(event?.version).toBe('9.9.9');
    expect(result.skipped).toContain(
      'event payment.completed exists and was not written by autocatalog; left as it is',
    );
    expect(await fs.readFile(path.join(catalog, 'teams/payments.mdx'), 'utf8')).toContain(
      'The real team page.',
    );
  });
});

describe('to-eventcatalog carries history', () => {
  it('files every earlier version under versioned/ with its own schema and narrative', async () => {
    const result = await exportRoots({
      roots: [starter],
      catalogDir: catalog,
      narrative: true,
    });

    expect(result.versions).toBe(2);

    const sdk = utils(catalog);
    expect((await sdk.getEvent('payment.completed'))?.version).toBe('1.0.0');
    const old = await sdk.getEvent('payment.completed', '0.9.0');
    expect(old?.version).toBe('0.9.0');
    expect(old?.markdown).toContain('Initial pre-release schema.');

    const oldSchema = path.join(
      catalog,
      'domains/payments/events/payment.completed/versioned/0.9.0/schema.json',
    );

    const expected = await fs.readFile(
      path.join(starter, 'payments/PaymentCompleted/versioned/0.9.0/schema.json'),
      'utf8',
    );

    expect(JSON.parse(await fs.readFile(oldSchema, 'utf8'))).toEqual(JSON.parse(expected));
  });

  it('exports history again without duplicating or losing it', async () => {
    await exportStarter();
    await exportStarter();

    const versioned = await fs.readdir(
      path.join(catalog, 'domains/payments/events/payment.completed/versioned'),
    );

    expect(versioned).toEqual(['0.9.0']);
  });
});

async function source(dir: string, files: Record<string, JsonObject>): Promise<string> {
  const root = path.join(catalog, '..', `${path.basename(catalog)}-${dir}`);

  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(body));
  }

  return root;
}

const schema = { type: 'object', properties: { id: { type: 'string' } } };

const event = (id: string, version: string) => ({ id, version, name: id, summary: id });

describe('to-eventcatalog removes only the files it generated', () => {
  it('keeps an asset someone added inside a generated domain or event', async () => {
    await exportStarter();
    await writeFile('domains/payments/diagram.png', 'not really a png');
    await writeFile('domains/payments/assets/flow.svg', '<svg/>');
    await writeFile('domains/payments/events/payment.completed/notes.md', 'Ours.');

    await exportStarter();

    expect(await exists('domains/payments/diagram.png')).toBe(true);
    expect(await exists('domains/payments/assets/flow.svg')).toBe(true);
    expect(await exists('domains/payments/events/payment.completed/notes.md')).toBe(true);
    expect(await exists('domains/payments/index.mdx')).toBe(true);
  });

  it('keeps the runtime evidence autotel-eventcatalog stamped into an event page', async () => {
    await exportStarter();
    const page = path.join(catalog, 'domains/payments/events/payment.completed/index.mdx');

    // What `autotel-eventcatalog stamp` appends to a page without a <Footer />.
    const stamped = `${(await fs.readFile(page, 'utf8')).trimEnd()}\n\n<!-- autotel:stamp-start -->\n\n<div class="evidence-callout">\n<strong>Observed in autotel snapshot</strong>\n\n**Volume**: 3 events\n</div>\n\n<!-- autotel:stamp-end -->\n`;

    await fs.writeFile(page, stamped);

    await exportStarter();

    // Byte for byte, so re-stamping after an export changes nothing.
    expect(await fs.readFile(page, 'utf8')).toBe(stamped);
  });

  it('takes over an export written before the manifest, so source changes still arrive', async () => {
    // The earlier format marked the domain, marked events without `managed`,
    // and left services unmarked, listed by the domain.
    await writeFile(
      'domains/payments/index.mdx',
      '---\nid: payments\nname: payments\nversion: 1.0.0\nservices:\n  - id: PaymentService\n    version: 1.0.0\nx-autocatalog:\n  managed: true\n---\n',
    );
    await writeFile(
      'domains/payments/services/PaymentService/index.mdx',
      '---\nid: PaymentService\nname: PaymentService\nversion: 1.0.0\n---\n\nStale. Produces 1 event(s). Inferred by autocatalog from the producers and consumers each event declares.\n',
    );
    await writeFile(
      'domains/payments/events/payment.completed/index.mdx',
      '---\nid: payment.completed\nname: Old\nversion: 0.1.0\nx-autocatalog:\n  provenance: declared\n---\n\nStale.\n',
    );
    await writeFile('domains/payments/events/payment.completed/schema.json', '{}');

    const result = await exportStarter();

    expect(result.skipped).toEqual([]);
    const sdk = utils(catalog);
    expect((await sdk.getEvent('payment.completed'))?.version).toBe('1.0.0');
    expect((await sdk.getService('PaymentService'))?.markdown).not.toContain('Stale.');
    expect(await exists('domains/payments/services/PaymentService/index.mdx')).toBe(true);
  });
});

describe('to-eventcatalog refuses an event id it would have to merge', () => {
  it('rejects the same id from two repositories before touching the project', async () => {
    await exportStarter();
    const before = await fs.readFile(path.join(catalog, '.autocatalog-export.json'), 'utf8');

    const a = await source('a', {
      'payments/Paid/autocatalog.json': event('payment.completed', '1.0.0'),
      'payments/Paid/schema.json': schema,
    });

    const b = await source('b', {
      'billing/Paid/autocatalog.json': event('payment.completed', '2.0.0'),
      'billing/Paid/schema.json': schema,
    });

    await expect(exportRoots({ roots: [a, b], catalogDir: catalog })).rejects.toThrow(
      /payment\.completed is published by .*-a \(payments\) and .*-b \(billing\)/,
    );
    expect(await fs.readFile(path.join(catalog, '.autocatalog-export.json'), 'utf8')).toBe(before);
    expect(await exists('domains/payments/events/payment.completed/index.mdx')).toBe(true);
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  });
});

describe('to-eventcatalog keeps the current version current', () => {
  it('leaves a historical prerelease in history, whatever its number', async () => {
    const root = await source('beta', {
      'payments/Paid/autocatalog.json': event('payment.completed', '1.0.0'),
      'payments/Paid/schema.json': schema,
      'payments/Paid/versioned/1.0.0-beta.2/autocatalog.json': event(
        'payment.completed',
        '1.0.0-beta.2',
      ),
      'payments/Paid/versioned/1.0.0-beta.2/schema.json': schema,
    });

    await exportRoots({ roots: [root], catalogDir: catalog });

    const sdk = utils(catalog);
    expect((await sdk.getEvent('payment.completed'))?.version).toBe('1.0.0');
    expect((await sdk.getEvent('payment.completed', '1.0.0-beta.2'))?.version).toBe('1.0.0-beta.2');
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('to-eventcatalog upgrades and recovers without losing ownership', () => {
  it('keeps notes and diagrams in history when taking over an export from before the manifest', async () => {
    const dir = 'domains/payments/events/payment.completed';
    await writeFile(
      `${dir}/index.mdx`,
      '---\nid: payment.completed\nname: Old\nversion: 0.1.0\nx-autocatalog:\n  provenance: declared\n---\n',
    );
    await writeFile(
      `${dir}/versioned/0.0.1/index.mdx`,
      '---\nid: payment.completed\nname: Older\nversion: 0.0.1\nx-autocatalog:\n  provenance: declared\n---\n',
    );
    await writeFile(`${dir}/versioned/0.0.1/schema.json`, '{}');
    await writeFile(`${dir}/versioned/0.0.1/notes.md`, 'Why 0.0.1 was withdrawn.');
    await writeFile(`${dir}/versioned/0.0.1/flow.png`, 'not really a png');
    await writeFile(`${dir}/examples/README.md`, 'How to read these.');

    await exportStarter();

    expect(await exists(`${dir}/versioned/0.0.1/index.mdx`)).toBe(false);
    expect(await exists(`${dir}/versioned/0.0.1/schema.json`)).toBe(false);
    expect(await exists(`${dir}/versioned/0.0.1/notes.md`)).toBe(true);
    expect(await exists(`${dir}/versioned/0.0.1/flow.png`)).toBe(true);
    expect(await exists(`${dir}/examples/README.md`)).toBe(true);
  });

  it('stops on a manifest it cannot read, and deletes nothing', async () => {
    await exportStarter();
    await writeFile('.autocatalog-export.json', '{ not json');

    await expect(exportStarter()).rejects.toThrow(/is not a list of the files autocatalog wrote/);
    expect(await exists('domains/payments/events/payment.completed/index.mdx')).toBe(true);
    expect(await exists('domains/payments/index.mdx')).toBe(true);
  });

  it('still owns what a failed export wrote, so the retry updates it', async () => {
    const files = (version: string) => ({
      'payments/B/autocatalog.json': event('b.second', '1.0.0'),
      'payments/B/schema.json': schema,
      'payments/A/autocatalog.json': event('a.first', version),
      'payments/A/schema.json': schema,
      'payments/C/autocatalog.json': event('c.third', '1.0.0'),
      'payments/C/schema.json': schema,
    });

    // A successful export first, so there is a manifest from before a.first.
    const before = await source('before', {
      'payments/B/autocatalog.json': event('b.second', '1.0.0'),
      'payments/B/schema.json': schema,
    });

    await exportRoots({ roots: [before], catalogDir: catalog });

    // Something in the way of c.third's schema makes the next export fail
    // after the new a.first is written.
    const root = await source('retry', files('1.0.0'));
    const blocker = 'domains/payments/events/c.third/schema.json';
    await fs.mkdir(path.join(catalog, blocker, 'in-the-way'), { recursive: true });
    await expect(exportRoots({ roots: [root], catalogDir: catalog })).rejects.toThrow();
    expect(await exists('domains/payments/events/a.first/index.mdx')).toBe(true);

    await fs.rm(path.join(catalog, blocker), { recursive: true });
    await source('retry', files('1.1.0'));
    const result = await exportRoots({ roots: [root], catalogDir: catalog });

    expect(result.skipped).toEqual([]);
    expect((await utils(catalog).getEvent('a.first'))?.version).toBe('1.1.0');
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(before, { recursive: true, force: true });
  });
});

describe('to-eventcatalog migration keeps what it cannot prove it wrote', () => {
  const legacyDomain = (services: string[]) =>
    writeFile(
      'domains/payments/index.mdx',
      `---\nid: payments\nname: payments\nversion: 1.0.0\nservices:\n${services
        .map((id) => `  - id: ${id}\n    version: 1.0.0\n`)
        .join('')}x-autocatalog:\n  managed: true\n---\n`,
    );

  it('keeps a hand-written service a marked domain links to, and says so', async () => {
    // Linked the way EventCatalog's addServiceToDomain links any service.
    await legacyDomain(['Refunds']);
    await writeFile(
      'domains/payments/services/Refunds/index.mdx',
      '---\nid: Refunds\nname: Refunds\nversion: 1.0.0\nschemaPath: schema.json\n---\n\nWritten by the payments team.\n',
    );
    await writeFile('domains/payments/services/Refunds/schema.json', '{"type":"object"}');

    const result = await exportStarter();

    expect(await exists('domains/payments/services/Refunds/schema.json')).toBe(true);

    const page = await fs.readFile(
      path.join(catalog, 'domains/payments/services/Refunds/index.mdx'),
      'utf8',
    );

    expect(page).toContain('Written by the payments team.');
    expect(result.skipped).toContain(
      'domains/payments/services/Refunds/index.mdx may be from an earlier export, but nothing shows autocatalog wrote it; left in place',
    );
  });

  it('keeps an example someone added to a generated event, and says so', async () => {
    const dir = 'domains/payments/events/payment.completed';
    await legacyDomain([]);
    await writeFile(
      `${dir}/index.mdx`,
      '---\nid: payment.completed\nname: Old\nversion: 0.1.0\nx-autocatalog:\n  provenance: declared\n---\n',
    );
    await writeFile(`${dir}/examples/success.json`, '{"stale": true}');
    await writeFile(`${dir}/examples/refund-edge-case.json`, '{"added": "by hand"}');

    const result = await exportStarter();

    // The export writes success.json again from source; the other is kept.
    expect(
      JSON.parse(await fs.readFile(path.join(catalog, dir, 'examples/success.json'), 'utf8')),
    ).not.toEqual({ stale: true });
    expect(await exists(`${dir}/examples/refund-edge-case.json`)).toBe(true);
    expect(result.skipped).toEqual([
      `${dir}/examples/refund-edge-case.json may be from an earlier export, but nothing shows autocatalog wrote it; left in place`,
    ]);
  });

  it('removes only event schemas, keeping and reporting one beside a domain or service', async () => {
    await legacyDomain(['PaymentService']);
    await writeFile('domains/payments/schema.json', '{"title":"payments domain model"}');
    await writeFile(
      'domains/payments/services/PaymentService/index.mdx',
      '---\nid: PaymentService\nname: PaymentService\nversion: 1.0.0\n---\n\nProduces 1 event(s). Inferred by autocatalog from the producers and consumers each event declares.\n',
    );
    await writeFile(
      'domains/payments/services/PaymentService/schema.json',
      '{"title":"service API, by hand"}',
    );
    const event = 'domains/payments/events/payment.completed';
    await writeFile(
      `${event}/index.mdx`,
      '---\nid: payment.completed\nname: Old\nversion: 0.1.0\nx-autocatalog:\n  provenance: declared\n---\n',
    );
    await writeFile(`${event}/schema.json`, '{"title":"stale generated schema"}');

    const result = await exportStarter();

    const read = (rel: string) => fs.readFile(path.join(catalog, rel), 'utf8');
    expect(await read('domains/payments/schema.json')).toContain('payments domain model');
    expect(await read('domains/payments/services/PaymentService/schema.json')).toContain(
      'service API, by hand',
    );
    expect(await read(`${event}/schema.json`)).not.toContain('stale generated schema');
    expect(result.skipped).toEqual([
      'domains/payments/schema.json may be from an earlier export, but nothing shows autocatalog wrote it; left in place',
      'domains/payments/services/PaymentService/schema.json may be from an earlier export, but nothing shows autocatalog wrote it; left in place',
    ]);
  });
});
