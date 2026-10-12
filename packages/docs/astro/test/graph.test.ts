// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '../src/ui/components/Graph';

// React Flow measures its box; jsdom has no layout, so the measure is empty.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}

    unobserve() {}

    disconnect() {}
  },
);

const intersect: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];

vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      intersect.push(callback);
    }

    observe() {}

    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  intersect.length = 0;
});

const props = {
  id: 'flow',
  label: 'Message flow',
  visualiser: { graph: { nodes: [], edges: [] }, hrefs: {} },
  fallback: createElement('p', null, 'static flow'),
};

describe('Graph', () => {
  it('serves a sized empty box, with the static picture for readers without JavaScript', () => {
    const html = renderToString(createElement(Graph, props));

    expect(html).toContain('data-graph-portal');
    expect(html).toMatch(/<noscript>.*static flow.*<\/noscript>/s);
  });

  it('loads the map only once its box nears the viewport', async () => {
    render(createElement(Graph, props));

    // Settle the module, so only the viewport can hold the map back.
    await act(() => import('../src/ui/components/Visualiser'));

    expect(screen.queryByRole('region', { name: 'Message flow' })).toBeNull();

    await act(async () => intersect[0]!([{ isIntersecting: true }]));

    expect(await screen.findByRole('region', { name: 'Message flow' })).toBeTruthy();
  });

  it('shows only the static picture when there is nothing to draw', () => {
    const html = renderToString(createElement(Graph, { ...props, visualiser: undefined }));

    expect(html).toContain('static flow');
    expect(html).not.toContain('noscript');
    expect(html).not.toContain('data-graph-portal');
  });
});
