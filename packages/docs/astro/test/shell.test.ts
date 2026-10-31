import { describe, expect, it } from 'vitest';
import { versionLabel, withMarkdownCopy } from '../src/shell';

describe('versionLabel', () => {
  it('prefixes a numeric version and leaves any other scheme alone', () => {
    expect(versionLabel('1.0.0')).toBe('v1.0.0');
    expect(versionLabel('V0')).toBe('V0');
    expect(versionLabel('2026-03')).toBe('v2026-03');
  });
});

describe('withMarkdownCopy', () => {
  it("puts Copy beside View after the page's other actions", () => {
    expect(
      withMarkdownCopy('/events/a.md', [
        { label: 'Copy schema', href: '/schema.json', icon: 'copy', copy: true },
      ]),
    ).toEqual([
      { label: 'Copy schema', href: '/schema.json', icon: 'copy', copy: true },
      { label: 'Copy page as Markdown', href: '/events/a.md', icon: 'copy', copy: true },
      { label: 'View as Markdown', href: '/events/a.md', icon: 'doc' },
    ]);
  });

  it('replaces an existing View or Copy so the pair is not doubled', () => {
    expect(
      withMarkdownCopy('/x.md', [
        { label: 'View as Markdown', href: '/old.md', icon: 'doc' },
        { label: 'Copy page as Markdown', href: '/old.md', icon: 'copy', copy: true },
      ]),
    ).toEqual([
      { label: 'Copy page as Markdown', href: '/x.md', icon: 'copy', copy: true },
      { label: 'View as Markdown', href: '/x.md', icon: 'doc' },
    ]);
  });
});
