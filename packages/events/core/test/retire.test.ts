import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/json';
import { deprecatedFields } from '../src/fields';
import { assessRetirement, pactEvidence, renderRetirement } from '../src/retire';

const declared = {
  source: 'payments-service',
  consumers: ['BillingService', 'LedgerService', 'AuditService'],
  fields: { BillingService: ['paymentId'], LedgerService: ['amount'] },
};

describe('assessRetirement', () => {
  it('blocks on a consumer that reads the field, one that says nothing, and one only seen at runtime', () => {
    const retirement = assessRetirement({
      event: 'payments/payment.completed',
      field: 'amount',
      declared: [declared],
      runtime: {
        source: 'snapshot of 2026-10-01',
        consumers: ['LedgerService', 'FraudService'],
        sends: true,
      },
    });

    expect(retirement.verdict).toBe('blocked');
    expect(retirement.consumers.map((c) => `${c.consumer} ${c.standing}`)).toEqual([
      'LedgerService reads',
      'FraudService unknown',
      'AuditService unspecified',
      'BillingService clear',
    ]);
    expect(retirement.next).toEqual([
      'LedgerService moves off amount',
      'Find out whether FraudService needs amount: it receives the event and declares nothing',
      'AuditService declares the fields it reads, in autocatalog.consumes.json',
    ]);
    expect(renderRetirement(retirement)).toContain(
      '- **LedgerService**: needs it. reads amount (payments-service); seen receiving the event (snapshot of 2026-10-01)',
    );
  });

  it('reads a consumer named after an object internal as one that declared no fields', () => {
    const retirement = assessRetirement({
      event: 'payments/payment.completed',
      field: 'amount',
      declared: [{ source: 'payments-service', consumers: ['constructor'], fields: {} }],
    });

    expect(retirement.consumers.map((c) => `${c.consumer} ${c.standing}`)).toEqual([
      'constructor unspecified',
    ]);
  });

  it('lets a pact settle a consumer that declared no fields, and is ready when every consumer is clear', () => {
    const retirement = assessRetirement({
      event: 'payments/payment.completed',
      field: 'amount',
      declared: [{ ...declared, consumers: ['BillingService', 'AuditService'] }],
      pacts: [
        {
          source: 'pact broker',
          consumer: 'AuditService',
          usesField: false,
          verified: { success: true, version: '4.2.0' },
        },
      ],
    });

    expect(retirement.verdict).toBe('ready');
    expect(retirement.consumers.find((c) => c.consumer === 'AuditService')?.evidence[1]?.says).toBe(
      'pact does not use amount; verified against 4.2.0',
    );
    expect(retirement.next).toEqual(["Remove amount and bump the event's major version"]);
  });
});

describe('pactEvidence', () => {
  const pact: JsonValue = {
    consumer: { name: 'LedgerService' },
    provider: { name: 'PaymentService' },
    messages: [
      { description: 'a PaymentCompleted event', contents: { amount: 12, lines: [{ sku: 'a' }] } },
      { description: 'a refund', contents: { reason: 'x' } },
    ],
  };

  it('finds the event’s messages by name and whether they carry the field', () => {
    const at = (field: string) =>
      pactEvidence(pact, {
        event: 'payments/payment.completed',
        field,
        source: 'pacts/ledger.json',
      });

    expect(at('amount')).toEqual({
      source: 'pacts/ledger.json',
      consumer: 'LedgerService',
      usesField: true,
    });
    expect(at('lines[].sku')?.usesField).toBe(true);
    expect(at('reason')?.usesField).toBe(false);
    expect(
      pactEvidence(pact, { event: 'payments/payment.flagged', source: 'pacts/ledger.json' }),
    ).toBeUndefined();
  });

  it('refuses a document that is not a pact rather than read it as one without the field', () => {
    expect(() =>
      pactEvidence(
        { consumer: { name: 'LedgerService' }, messages: [{ contents: { amount: 1 } }] },
        { event: 'payments/payment.completed', field: 'amount', source: 'x.json' },
      ),
    ).toThrow(/^not a pact/);
  });

  it('reads an HTTP pact as a pact with no message for the event', () => {
    const http: JsonValue = {
      consumer: { name: 'Web' },
      provider: { name: 'PaymentService' },
      interactions: [
        {
          description: 'a request for a payment',
          request: { method: 'GET', path: '/payments/1' },
          response: { status: 200, body: { amount: 1 } },
        },
      ],
      metadata: { pactSpecification: { version: '3.0.0' } },
    };

    expect(
      pactEvidence(http, {
        event: 'payments/payment.completed',
        field: 'amount',
        source: 'web.json',
      }),
    ).toBeUndefined();
  });

  it('refuses an untyped interaction that is not HTTP', () => {
    expect(() =>
      pactEvidence(
        {
          consumer: { name: 'LedgerService' },
          interactions: [{ description: 'a PaymentCompleted event', contents: { amount: 1 } }],
        },
        { event: 'payments/payment.completed', field: 'amount', source: 'x.json' },
      ),
    ).toThrow(/^not a pact/);
  });

  it('reads a synchronous message’s request and responses, and refuses a body it cannot read', () => {
    const synchronous = (response: JsonValue): JsonValue => ({
      consumer: { name: 'LedgerService' },
      interactions: [
        {
          type: 'Synchronous/Messages',
          description: 'payment.completed',
          request: { contents: { content: { paymentId: 'p' } } },
          response: [{ contents: response }],
        },
      ],
    });

    const at = (response: JsonValue) =>
      pactEvidence(synchronous(response), {
        event: 'payments/payment.completed',
        field: 'amount',
        source: 'x.json',
      });

    expect(at({ content: { amount: 1 } })?.usesField).toBe(true);
    expect(() => at({ content: 'eyJhbW91bnQiOjF9', encoded: 'base64' })).toThrow(
      'a message body that is not JSON cannot be read',
    );
  });

  it('reads Pact 4 message interactions', () => {
    const v4: JsonValue = {
      consumer: { name: 'FraudService' },
      interactions: [
        {
          type: 'Asynchronous/Messages',
          description: 'payment.completed',
          contents: { content: { amount: 1 } },
        },
      ],
    };

    expect(
      pactEvidence(v4, { event: 'payments/payment.completed', field: 'amount', source: 'broker' })
        ?.usesField,
    ).toBe(true);
  });
});

describe('deprecatedFields', () => {
  it('lists the fields a schema marks deprecated, nested ones included', () => {
    expect(
      deprecatedFields({
        type: 'object',
        properties: {
          amount: { type: 'number', deprecated: true },
          customer: {
            type: 'object',
            properties: { legacyId: { type: 'string', deprecated: true }, id: { type: 'string' } },
          },
        },
      }),
    ).toEqual(['amount', 'customer.legacyId']);
  });
});
