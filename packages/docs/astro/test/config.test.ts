import { afterEach, describe, expect, it, vi } from 'vitest';
import { docsSiteConfig, servesDocumentCopies, servesMcp } from '../src/config';

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

describe('mcp', () => {
  const access = { module: 'site/access.ts' };

  it('serves /mcp by default only on a server site that knows what each reader may open', () => {
    expect(servesMcp({ mcp: undefined, access, audience: undefined }, 'server')).toBe(true);
    expect(servesMcp({ mcp: undefined, access: undefined, audience: 'public' }, 'server')).toBe(
      true,
    );
    expect(servesMcp({ mcp: undefined, access: undefined, audience: undefined }, 'server')).toBe(
      false,
    );
    expect(servesMcp({ mcp: true, access: undefined, audience: undefined }, 'static')).toBe(false);
  });

  it('is what the site says on a server site', () => {
    expect(servesMcp({ mcp: true, access: undefined, audience: undefined }, 'server')).toBe(true);
    expect(servesMcp({ mcp: false, access, audience: 'public' }, 'server')).toBe(false);
  });

  it('reads the setting from the build, unset when the site names none', () => {
    vi.stubEnv('AUTOCATALOG_SITE_MCP', '');
    expect(docsSiteConfig().mcp).toBeUndefined();

    vi.stubEnv('AUTOCATALOG_SITE_MCP', 'true');
    expect(docsSiteConfig().mcp).toBe(true);

    vi.stubEnv('AUTOCATALOG_SITE_MCP', 'false');
    expect(docsSiteConfig().mcp).toBe(false);
  });
});

describe('servesDocumentCopies', () => {
  it('serves twins built ahead, and per request only where the site knows who reads', () => {
    expect(servesDocumentCopies({ perRequest: false, access: false, audience: undefined })).toBe(
      true,
    );
    expect(servesDocumentCopies({ perRequest: true, access: true, audience: undefined })).toBe(
      true,
    );
    expect(servesDocumentCopies({ perRequest: true, access: false, audience: 'public' })).toBe(
      true,
    );
    expect(servesDocumentCopies({ perRequest: true, access: false, audience: undefined })).toBe(
      false,
    );
  });
});
