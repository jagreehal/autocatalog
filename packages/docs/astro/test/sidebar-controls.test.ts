import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SidebarControls } from '../src/ui/overrides/SidebarControls';

describe('SidebarControls', () => {
  it('exposes a collapse toggle and a resize handle for the rail edge', () => {
    const html = renderToStaticMarkup(createElement(SidebarControls));

    expect(html).toContain('data-sidebar-toggle');
    expect(html).toContain('data-sidebar-toggle');
    expect(html).toContain('Collapse sidebar');
    expect(html).toContain('data-sidebar-resizer');
    expect(html).toContain('data-sidebar-resizer');
    expect(html).toContain('Resize sidebar');
  });
});
