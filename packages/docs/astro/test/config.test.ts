import { afterEach, describe, expect, it, vi } from 'vitest';
import { docsSiteConfig, servesDocumentCopies, servesMcp } from '../src/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiReference', () => {
  it('frames the reference beside the site’s navigation, for readers inside and out', () => {
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE', '');

    for (const audience of ['', 'public']) {
      vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', audience);
      expect(docsSiteConfig().apiReference).toBe('frame');
    }
  });

  it('calls the link to a reference Scalar, unless the site names it', () => {
    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE_LABEL', '');
    expect(docsSiteConfig().apiReferenceLabel).toBe('Scalar');

    vi.stubEnv('AUTOCATALOG_SITE_API_REFERENCE_LABEL', 'API reference');
    expect(docsSiteConfig().apiReferenceLabel).toBe('API reference');
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
