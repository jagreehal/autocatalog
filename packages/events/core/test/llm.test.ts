import { describe, expect, it } from 'vitest';
import { eventToLlmText, catalogToLlmText } from '../src/llm';

const e1 = {
  id: 'payment.completed',
  version: '1.0.0',
  name: 'Payment Completed',
  summary: 'Fires when a payment completes',
  domain: 'payments',
  producers: ['PaymentService'],
  consumers: ['LedgerService'],
  schema: { type: 'object', properties: { id: { type: 'string' } } },
  body: 'A payment.completed event is published when the payment has been authorised.',
  examples: [{ name: 'default', data: { id: 'pay_1' } }],
};

const e2 = {
  id: 'kyc.submitted',
  version: '1.0.0',
  name: 'KYC Submitted',
  summary: 'Fires when a KYC is submitted',
  domain: 'kyc',
  producers: [],
  consumers: [],
  schema: { type: 'object', properties: {} },
  body: '',
  examples: [],
};

describe('eventToLlmText', () => {
  it('emits a markdown block with all key fields', () => {
    const text = eventToLlmText(e1);
    expect(text).toContain('# Payment Completed');
    expect(text).toContain('id: payment.completed');
    expect(text).toContain('version: 1.0.0');
    expect(text).toContain('## Schema');
    expect(text).toContain('"type": "object"');
    expect(text).toContain('## Example: default');
    expect(text).toContain('"pay_1"');
    expect(text).toContain('Produced by: PaymentService');
    expect(text).toContain('Consumed by: LedgerService');
  });

  it('omits empty sections', () => {
    const text = eventToLlmText(e2);
    expect(text).not.toContain('Produced by:');
    expect(text).not.toContain('Consumed by:');
    expect(text).not.toContain('## Example');
  });
});

describe('catalogToLlmText', () => {
  it('emits a top-level catalog block with a TOC then each event', () => {
    const text = catalogToLlmText([e1, e2]);
    expect(text).toContain('# Event Catalog');
    expect(text).toContain('## Contents');
    expect(text).toContain('- payments / payment.completed (v1.0.0)');
    expect(text).toContain('- kyc / kyc.submitted (v1.0.0)');
    expect(text).toContain('---');
    expect(text).toContain('# Payment Completed');
    expect(text).toContain('# KYC Submitted');
  });
});
