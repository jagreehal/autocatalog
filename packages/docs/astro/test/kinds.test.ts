import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentsAbout } from '../src/about';
import { buildDocsCatalog } from '../src/catalog';
import { documentsByKind, kindHeader, kindIndexProps, kindNoun } from '../src/kinds';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-kinds-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const doc = (title: string, extra = '') =>
  `---\ntitle: ${title}\nowner: Payments\n${extra}---\n\nBody.\n`;

/** Two decisions, the newer replacing the older, and an event they both apply to. */
async function decisions(): Promise<void> {
  const folder = 'payments-service/events/payments/PaymentCaptured';

  await write(
    `${folder}/autocatalog.json`,
    JSON.stringify({
      spec: 'autocatalog/v2',
      id: 'payment.captured',
      version: '1.0.0',
      name: 'Payment captured',
      summary: 'A payment was captured.',
      domain: 'payments',
      producers: ['PaymentService'],
      schema: 'schema.json',
    }),
  );
  await write(`${folder}/schema.json`, JSON.stringify({ type: 'object' }));
  await write(
    'payments-service/docs/adr/0001-rabbitmq.md',
    doc(
      'Use RabbitMQ',
      'status: superseded\ndate: 2025-01-09\nsupersededBy:\n  - payments-service/adr/0002-kafka\n',
    ),
  );
  await write(
    'payments-service/docs/adr/0002-kafka.md',
    doc(
      'Use Kafka',
      'status: accepted\ndate: 2026-03-14\nabout:\n  - service/PaymentService\n  - event/payments/payment.captured\n',
    ),
  );
  await write(
    'payments-service/docs/guide.md',
    doc('Guide', 'about:\n  - service/PaymentService\n'),
  );
}

describe('document kinds on the site', () => {
  it('lists one kind newest first, with its states in the order they move', async () => {
    await decisions();

    const catalog = await buildDocsCatalog(root, { includeDates: false });
    const [adr] = catalog.kinds;

    // Only kinds with documents get a page.
    expect(catalog.kinds.map((kind) => kind.id)).toEqual(['adr']);

    const page = kindIndexProps(catalog, adr!);

    expect(page.rows.map((row) => row.title)).toEqual(['Use Kafka', 'Use RabbitMQ']);
    expect(page.statuses).toEqual(['accepted', 'superseded']);
    expect(page.rows[0]!.cells.status).toEqual({ text: 'accepted', status: true });
    expect(page.rows[0]!.cells.date).toEqual({ text: '14 Mar 2026' });
    expect(page.chains.map((chain) => chain.map((link) => link.title))).toEqual([
      ['Use RabbitMQ', 'Use Kafka'],
    ]);
  });

  it('heads a decision with its state, date, what it applies to and what it replaced', async () => {
    await decisions();

    const catalog = await buildDocsCatalog(root, { includeDates: false });
    const header = kindHeader(catalog, 'payments-service/adr/0002-kafka', '/');

    expect(header?.status).toBe('accepted');
    expect(header?.facts).toEqual([
      { term: 'Kind', links: [{ label: 'Decisions', href: '/decisions/' }] },
      { term: 'Date', text: '14 Mar 2026' },
      {
        term: 'Applies to',
        links: expect.arrayContaining([
          { label: 'PaymentService', href: '/services/PaymentService/' },
          {
            label: 'Payment captured',
            href: '/events/payments-service/payments/payment.captured/',
          },
        ]),
      },
    ]);

    expect(kindHeader(catalog, 'payments-service/adr/0001-rabbitmq', '/')?.facts).toContainEqual({
      term: 'Superseded by',
      links: [{ label: 'Use Kafka', href: '/payments-service/adr/0002-kafka' }],
    });
    expect(kindHeader(catalog, 'payments-service/guide', '/')).toBeUndefined();
  });

  it('links a replaced decision only when this site publishes it', async () => {
    await write(
      'payments-service/docs/adr/0003-outbox.md',
      doc(
        'Use an outbox',
        'status: accepted\ndate: 2026-04-01\nsupersedes:\n  - payments-service/adr/0099-missing\n',
      ),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });
    const header = kindHeader(catalog, 'payments-service/adr/0003-outbox', '/');

    expect(header?.facts.map((fact) => fact.term)).not.toContain('Supersedes');
  });

  it('gives a service page a card per kind, apart from its plain documents', async () => {
    await decisions();

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    const { documents, records } = documentsByKind(
      catalog.kinds,
      documentsAbout(catalog.graph, { kind: 'service', id: 'PaymentService' }),
    );

    expect(documents.map((link) => link.title)).toEqual(['Guide']);
    expect(records).toEqual([
      {
        id: 'decisions',
        heading: 'Decisions',
        links: [expect.objectContaining({ title: 'Use Kafka', status: 'accepted' })],
      },
    ]);
  });

  it('refuses a kind whose index would take a repository’s address', async () => {
    await write('decisions/docs/readme.md', doc('Readme'));
    await write(
      'payments-service/docs/adr/0001.md',
      doc('Use Kafka', 'status: accepted\ndate: 2026-03-14\n'),
    );

    await expect(buildDocsCatalog(root, { includeDates: false })).rejects.toThrow(
      /\/decisions\/ would share its address with the decisions repository's documents/,
    );
  });

  it('counts a kind in words', async () => {
    await decisions();

    const [adr] = (await buildDocsCatalog(root, { includeDates: false })).kinds;

    expect(kindNoun(adr!, 1)).toBe('decision');
    expect(kindNoun(adr!, 2)).toBe('decisions');
  });
});
