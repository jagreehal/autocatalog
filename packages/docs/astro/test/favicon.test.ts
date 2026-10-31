import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FAVICON, resolveFavicon } from '../src/favicon';

const faviconFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../site/public/favicon.svg',
);

describe('resolveFavicon', () => {
  it('prefers Starlight config, then the env, then the shipped default', () => {
    expect(resolveFavicon('/brand.svg', {})).toBe('/brand.svg');
    expect(resolveFavicon(undefined, { AUTOCATALOG_SITE_FAVICON: '/custom.svg' })).toBe(
      '/custom.svg',
    );
    expect(resolveFavicon(undefined, {})).toBe(DEFAULT_FAVICON);
    expect(resolveFavicon('  ', { AUTOCATALOG_SITE_FAVICON: '  ' })).toBe(DEFAULT_FAVICON);
  });
});

describe('shipped favicon', () => {
  it('is a geometric SVG of the three provenance states, not an emoji', () => {
    const svg = fs.readFileSync(faviconFile, 'utf8');

    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 32 32"');
    // Declared / extracted / inferred marks from DESIGN.md.
    expect(svg).toContain('#6b4fd6');
    expect(svg).toContain('#17a89c');
    expect(svg).toContain('#e0a95c');
    expect(svg).not.toMatch(/📖|📕|<text/);
  });
});
