import { afterEach, describe, expect, it, vi } from 'vitest';
import { docsSiteConfig } from '../src/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiReference', () => {
  it('is embedded on the company’s own site, beside the rest of the catalog', () => {
    vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', '');
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE', '');

    expect(docsSiteConfig().apiReference).toBe('embedded');
  });

  it('is full for readers outside, who come for the reference itself', () => {
    vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', 'public');
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE', '');

    expect(docsSiteConfig().apiReference).toBe('full');
  });

  it('is what the site says, whoever reads it', () => {
    vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', 'public');
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE', 'embedded');

    expect(docsSiteConfig().apiReference).toBe('embedded');

    vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', '');
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE', 'full');

    expect(docsSiteConfig().apiReference).toBe('full');
  });
});
