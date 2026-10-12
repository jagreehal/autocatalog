import { describe, expect, it } from 'vitest';
import { parseOtlpJson } from './parse.js';

describe('parseOtlpJson', () => {
  it('reads the rest of a document when one attribute value has a type it does not read', () => {
    const otlp = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'refund-agent' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  name: 'llm.chat',
                  attributes: [
                    { key: 'gen_ai.request.model', value: { stringValue: 'fast-model' } },
                    // An exporter that writes a count as an object.
                    { key: 'gen_ai.usage.tokens', value: { intValue: { low: 12, high: 0 } } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const observations = parseOtlpJson(otlp);

    expect(observations.spanCount).toBe(1);
    expect([...observations.agents]).toEqual(['refund-agent']);
    expect([...(observations.modelUsage.get('refund-agent') ?? [])]).toEqual(['fast-model']);
  });

  it('still rejects a document whose structure is wrong', () => {
    expect(() => parseOtlpJson(JSON.stringify({ resourceSpans: 'none' }))).toThrow();
  });
});
