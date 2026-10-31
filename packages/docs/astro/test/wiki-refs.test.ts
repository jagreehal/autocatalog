import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { describe, expect, it } from 'vitest';
import { parseWikiRef, remarkWikiRefs, wikiRefHref } from '../src/wiki-refs';

describe('parseWikiRef', () => {
  it('reads kind and id', () => {
    expect(parseWikiRef('[[service|PaymentService]]')).toEqual({
      kind: 'service',
      id: 'PaymentService',
    });
    expect(parseWikiRef('[[event|payments/payment.completed]]')).toEqual({
      kind: 'event',
      id: 'payments/payment.completed',
    });
  });

  it('rejects unknown kinds and empty ids', () => {
    expect(parseWikiRef('[[foo|bar]]')).toBeNull();
    expect(parseWikiRef('[[service|]]')).toBeNull();
    expect(parseWikiRef('not a ref')).toBeNull();
  });
});

describe('wikiRefHref', () => {
  it('builds the page URL for each kind', () => {
    expect(wikiRefHref({ kind: 'service', id: 'PaymentService' }, '')).toBe(
      '/services/PaymentService/',
    );
    expect(wikiRefHref({ kind: 'domain', id: 'payments' }, '/docs')).toBe(
      '/docs/domains/payments/',
    );
    expect(wikiRefHref({ kind: 'event', id: 'payments-service/payments/payment.completed' })).toBe(
      '/events/payments-service/payments/payment.completed/',
    );
    expect(wikiRefHref({ kind: 'event', id: 'payments/payment.completed' })).toContain(
      'kind=event',
    );
  });
});

describe('remarkWikiRefs', () => {
  it('turns a wiki ref into a catalog link and leaves other prose alone', async () => {
    const processor = await createMarkdownProcessor({
      remarkPlugins: [remarkWikiRefs],
    });

    const { code } = await processor.render(
      'See [[service|PaymentService]] and `[[service|raw]]`.\n',
    );

    expect(code).toContain('href="/services/PaymentService/"');
    expect(code).toContain('data-wiki-ref="service"');
    expect(code).toContain('PaymentService');
    expect(code).toContain('<code>');
  });
});
