import { describe, expect, it } from 'vitest';
import { versionLabel } from '../src/shell';

describe('versionLabel', () => {
  it('prefixes a numeric version and leaves any other scheme alone', () => {
    expect(versionLabel('1.0.0')).toBe('v1.0.0');
    expect(versionLabel('V0')).toBe('V0');
    expect(versionLabel('2026-03')).toBe('v2026-03');
  });
});
