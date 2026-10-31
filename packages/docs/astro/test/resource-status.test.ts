import { describe, expect, it } from 'vitest';
import { statusBanners, statusPills } from '../src/resource-status';

describe('statusPills', () => {
  it('flags draft, deprecated, review and a newer version', () => {
    expect(
      statusPills({
        status: 'deprecated',
        version: '1.0.0',
        needsReview: true,
        newer: { version: '2.0.0', href: '/e/' },
      }),
    ).toEqual([
      { text: 'v1.0.0' },
      { text: 'deprecated', tone: 'warn' },
      { text: 'needs review', tone: 'warn' },
      { text: 'new version available', tone: 'warn' },
    ]);
  });

  it('keeps an active event quiet', () => {
    expect(statusPills({ status: 'active', version: '1.2.0' })).toEqual([{ text: 'v1.2.0' }]);
  });
});

describe('statusBanners', () => {
  it('orders newer, deprecated, draft and review so the page shouts each one', () => {
    const banners = statusBanners({
      status: 'draft',
      deprecation: 'Use payment.settled.',
      needsReview: true,
      newer: { version: '2.0.0', href: '/events/x/' },
    });

    expect(banners.map((banner) => banner.title)).toEqual([
      'New version available',
      'Deprecated',
      'Draft',
      'Needs review',
    ]);
    expect(banners[0]?.href).toBe('/events/x/');
  });
});
