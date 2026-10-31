import { describe, expect, it } from 'vitest';
import { EMBED_SCRIPT, embedFromSearch } from '../src/embed';

describe('embedFromSearch', () => {
  it('accepts embed=1 and embed=true', () => {
    expect(embedFromSearch('?embed=1')).toBe(true);
    expect(embedFromSearch('embed=true')).toBe(true);
    expect(embedFromSearch('?embed=0')).toBe(false);
    expect(embedFromSearch('')).toBe(false);
  });
});

describe('EMBED_SCRIPT', () => {
  it('stamps data-embed before paint', () => {
    expect(EMBED_SCRIPT).toContain("params.get('embed')");
    expect(EMBED_SCRIPT).toContain("dataset.embed = '1'");
  });
});
