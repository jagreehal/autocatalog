import { describe, expect, it } from 'vitest';
import { renderLlmsTxt } from '../src/llms';

describe('renderLlmsTxt', () => {
  const base = 'https://docs.acme.example';

  it('links documents to their markdown twins and events to their schemas', () => {
    const text = renderLlmsTxt({
      title: 'Acme',
      description: 'Everything Acme publishes.',
      base,
      items: [
        {
          id: 'payments-service/runbook',
          repo: 'payments-service',
          title: 'Runbook',
          owner: 'Payments',
          updated: null,
          tags: [],
        },
      ],
      events: [
        {
          path: 'events/payments-service/payments/payment.captured/',
          name: 'Payment captured',
          summary: 'A payment was captured.',
          owner: 'Payments',
        },
      ],
    });

    expect(text).toContain(`- [Runbook](${base}/payments-service/runbook.md): owned by Payments`);
    expect(text).toContain('## Events');
    expect(text).toContain(
      `- [Payment captured](${base}/events/payments-service/payments/payment.captured/schema.json): A payment was captured; owned by Payments`,
    );
  });

  it('leaves the events section out when nothing publishes events', () => {
    const text = renderLlmsTxt({ title: 'Acme', description: 'Docs.', base, items: [] });
    expect(text).not.toContain('## Events');
  });
});
