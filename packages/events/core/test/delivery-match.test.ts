import { describe, expect, it } from 'vitest';
import { globMatches } from '../src/delivery-aws';
import { rabbitPatternMatches, safePattern, topicMatches } from '../src/delivery-match';
import { nodeOf } from '../src/delivery-model';

// Patterns in a pull request are untrusted: each check must finish at once.
const fast = (check: () => boolean | undefined) => {
  const start = performance.now();

  check();

  return performance.now() - start < 200;
};

describe('topicMatches', () => {
  it('matches topic patterns', () => {
    expect(topicMatches('payments.#', 'payments.card.completed')).toBe(true);
    expect(topicMatches('*.completed', 'payments.completed')).toBe(true);
    expect(topicMatches('#.refund.#', 'payments.completed')).toBe(false);
  });

  it('stays fast on a run of # that cannot match', () => {
    const pattern = [...Array.from({ length: 40 }, () => '#'), 'never'].join('.');
    const key = Array.from({ length: 40 }, () => 'word').join('.');

    expect(fast(() => topicMatches(pattern, key))).toBe(true);
    expect(topicMatches(pattern, key)).toBe(false);
  });
});

describe('RabbitMQ patterns', () => {
  it('evaluates up to two stars and 255 characters, and nothing past them', () => {
    expect(rabbitPatternMatches('^ledger\\..*$', 'ledger.payments')).toBe(true);
    expect(safePattern('a.*b.*c.*')).toBeUndefined();
    expect(safePattern('a'.repeat(256))).toBeUndefined();
    expect(rabbitPatternMatches('^a.*b.*$', 'a'.repeat(256))).toBeUndefined();
  });

  it('evaluates only escapes PCRE and JavaScript read the same way', () => {
    expect(rabbitPatternMatches('^ledger\\.payments$', 'ledger.payments')).toBe(true);
    expect(rabbitPatternMatches('^ledger\\\\x$', 'ledger\\x')).toBe(true);
    // An anchor in PCRE, the letter A in JavaScript.
    expect(rabbitPatternMatches('\\Aledger', 'ledger')).toBeUndefined();
    expect(rabbitPatternMatches('ledger\\Z', 'ledger')).toBeUndefined();
  });
});

describe('IAM action wildcards', () => {
  it('match without a regular expression', () => {
    expect(globMatches('sns:*', 'sns:publish')).toBe(true);
    expect(globMatches('sqs:send*', 'sqs:sendmessage')).toBe(true);
    expect(globMatches('sqs:?endmessage', 'sqs:sendmessage')).toBe(true);
    expect(globMatches('sqs:receive*', 'sqs:sendmessage')).toBe(false);
    expect(globMatches('sns.publish', 'snsxpublish')).toBe(false);
  });

  it('stay fast on a pattern built to backtrack', () => {
    const pattern = `${'a*'.repeat(30)}b`;
    const action = 'a'.repeat(5000);

    expect(fast(() => globMatches(pattern, action))).toBe(true);
    expect(globMatches(pattern, action)).toBe(false);
  });
});

describe('a broker node from another graph', () => {
  it('keeps a plain note, and replaces one that could inject Markdown anywhere in it', () => {
    const node = nodeOf({
      ref: { kind: 'queue', namespace: 'rabbitmq', id: 'ledger.payments' },
      title: 'ledger.payments',
      tags: [],
      provenance: { default: 'extracted', fields: {} },
      needsReview: false,
      attributes: {
        system: 'rabbitmq',
        entity: 'queue](https://evil.example)',
        role: 'store',
        unevaluated: [
          'policy `dlx` uses a pattern that is not evaluated',
          'see [the runbook](https://evil.example) @org/security',
          '\\`[x](https://evil.example)`',
          'two\nlines',
        ],
      },
    });

    expect(node?.entity).toBe('node');
    expect(node?.unevaluated).toEqual([
      'policy `dlx` uses a pattern that is not evaluated',
      'a rule here is not evaluated',
      'a rule here is not evaluated',
      'a rule here is not evaluated',
    ]);
  });
});
