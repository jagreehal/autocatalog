import { describe, expect, it } from 'vitest';
import { attentionSnapshot, hasAttention, type AttentionSource } from '../src/attention';

const emptyCatalog: AttentionSource = {
  events: [],
  failures: [],
  graph: { resources: [] },
  summary: { needsReview: 0 },
};

describe('attentionSnapshot', () => {
  it('counts review work, quarantine failures and orphans', () => {
    const catalog: AttentionSource = {
      summary: { needsReview: 2 },
      failures: [{ repository: 'broken', message: 'invalid manifest' }],
      events: [
        {
          event: {
            frontmatter: {
              producers: [],
              consumers: ['Ledger'],
            },
          },
        },
        {
          event: {
            frontmatter: {
              producers: ['Pay'],
              consumers: [],
            },
          },
        },
      ],
      graph: {
        resources: [{}, { owner: { team: 'Pay' } }],
      },
    };

    const attention = attentionSnapshot(catalog, '/');

    expect(attention.needsReview).toBe(2);
    expect(attention.failures).toEqual([{ repository: 'broken', message: 'invalid manifest' }]);
    expect(attention.orphanProducers).toBe(1);
    expect(attention.orphanConsumers).toBe(1);
    expect(attention.unowned).toBe(1);
    expect(hasAttention(attention)).toBe(true);
    expect(hasAttention(attentionSnapshot(emptyCatalog, '/'))).toBe(false);
  });
});
