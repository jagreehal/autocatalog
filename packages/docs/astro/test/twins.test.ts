import { describe, expect, it } from 'vitest';
import { eventFrontmatter } from 'autocatalog-core';
import type { CatalogEvent } from '../src/catalog';
import { docTwin, eventTwin, serviceTwin, twinPath } from '../src/twins';

const entry = (body = ''): CatalogEvent => ({
  repository: 'payments-service',
  // SAFETY: a twin reads only the frontmatter, the body and the schema.
  event: {
    frontmatter: {
      ...eventFrontmatter.parse({
        id: 'payment.captured',
        version: '1.2.0',
        name: 'Payment captured',
        summary: 'A payment was captured.',
        owner: { team: 'payments' },
        producers: ['PaymentService'],
        consumers: ['LedgerService'],
      }),
      domain: 'payments',
    },
    body,
    schema: { type: 'object', properties: { amount: { type: 'number' } } },
  } as never,
});

describe('docTwin', () => {
  it('says the kind a folder gave a document, which its own frontmatter may leave out', () => {
    const md = docTwin(
      {
        id: 'payments-service/adr/0002-kafka',
        repo: 'payments-service',
        file: 'payments-service/docs/adr/0002-kafka.md',
        data: { title: 'Use Kafka', owner: 'Payments', status: 'accepted', date: '2026-03-14' },
        body: 'We moved.\n',
      },
      {
        'payments-service/adr/0002-kafka': {
          owner: 'Payments',
          title: 'Use Kafka',
          updated: null,
          source: null,
          edit: null,
          linkedFrom: [],
          kind: 'adr',
          status: 'accepted',
          date: '2026-03-14',
        },
      },
    );

    expect(md).toMatch(/^---\nkind: adr\ntitle: Use Kafka\n/);
    expect(md).toContain('status: accepted\ndate: 2026-03-14\n');
  });
});

describe('twinPath', () => {
  it('puts .md where the page has its trailing slash', () => {
    expect(twinPath('events/payments-service/payments/payment.captured/')).toBe(
      'events/payments-service/payments/payment.captured.md',
    );
  });
});

describe('eventTwin', () => {
  it('says who owns, produces and consumes the event, then gives its narrative and schema', () => {
    const md = eventTwin(
      entry('Emitted after capture.\n\n```mermaid\ngraph LR\n  A --> B\n```\n'),
      {
        source: 'https://github.com/acme/payments/tree/main/events/payment.captured',
        url: 'https://docs.acme.example/events/payments-service/payments/payment.captured/',
      },
    );

    expect(md).toMatch(/^---\nid: payment\.captured\nversion: 1\.2\.0\n/);
    expect(md).toContain('owner: payments');
    expect(md).toContain('producers:\n  - PaymentService');
    expect(md).toContain('consumers:\n  - LedgerService');
    expect(md).toContain(
      'source: https://github.com/acme/payments/tree/main/events/payment.captured',
    );
    expect(md).toContain('url: https://docs.acme.example/events/');
    expect(md).toContain('# Payment captured\n\nA payment was captured.\n\nEmitted after capture.');
    // The narrative's diagrams stay as their source.
    expect(md).toContain('```mermaid\ngraph LR\n  A --> B\n```');
    expect(md).toContain('## Schema\n\n```json\n{\n  "type": "object"');
  });

  it('leaves out what it does not know', () => {
    const md = eventTwin(entry(), {});

    expect(md).not.toContain('source:');
    expect(md).not.toContain('url:');
  });
});

describe('serviceTwin', () => {
  it('lists what the service produces and consumes, each linked to its twin', () => {
    const md = serviceTwin(
      { name: 'PaymentService', owner: 'Payments' },
      { produces: [entry()], consumes: [] },
      { base: '/catalog/', url: 'https://docs.acme.example/catalog/services/PaymentService/' },
    );

    expect(md).toContain('name: PaymentService');
    expect(md).toContain('owner: Payments');
    expect(md).toContain('produces:\n  - payments/payment.captured');
    expect(md).toContain('## Produces');
    expect(md).toContain(
      '- [Payment captured](/catalog/events/payments-service/payments/payment.captured.md): `payments/payment.captured`',
    );
    expect(md).not.toContain('## Consumes');
  });
});
