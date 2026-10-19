import { describe, expect, it } from 'vitest';
import { renderLlmsFullTxt, renderLlmsTxt } from '../src/llms';

describe('renderLlmsTxt', () => {
  const base = 'https://docs.acme.example';

  it('links documents and events to their markdown twins, and points at the full text', () => {
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
      `- [Payment captured](${base}/events/payments-service/payments/payment.captured.md): A payment was captured; owned by Payments`,
    );
    expect(text).toContain(`[llms-full.txt](${base}/llms-full.txt)`);
  });

  it('leaves the events section out when nothing publishes events', () => {
    const text = renderLlmsTxt({ title: 'Acme', description: 'Docs.', base, items: [] });
    expect(text).not.toContain('## Events');
  });
});

describe('renderLlmsFullTxt', () => {
  it('is the header, then every twin in full', () => {
    const text = renderLlmsFullTxt({
      title: 'Acme',
      description: 'Everything Acme publishes.',
      twins: ['---\nid: a\n---\n\n# A\n', '---\nid: b\n---\n\n# B\n'],
    });

    expect(text).toBe(
      '# Acme\n\n> Everything Acme publishes.\n\n---\nid: a\n---\n\n# A\n\n---\nid: b\n---\n\n# B\n',
    );
  });
});
