// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openReadable, readablePinch } from '../src/ui/lib/open-readable';

// As the visualiser pads its own fit.
const PADDING = { top: '100px', left: '60px' };

const from = { x: 40, y: 190 };

const to = { x: 60, y: 100 };

it.each(
  [true, false].flatMap((mac) => [0.07, 0.14, 0.4].map((zoom): [boolean, number] => [mac, zoom])),
)('zooms a map that opens too small up to a readable size (Mac: %s, at %s)', (mac, zoom) => {
  const pinch = readablePinch(zoom, mac, { from, to });

  expect.assert(pinch, 'it pinches');

  // React Flow's own reading of a Ctrl+wheel event in pages.
  const scale = 2 ** (-pinch.deltaY * (mac ? 10 : 1));

  expect(zoom * scale).toBeCloseTo(0.9);

  // Zoomed about the pointer, the drawing's corner lands where it was sent.
  expect(pinch.clientX + (from.x - pinch.clientX) * scale).toBeCloseTo(to.x);
  expect(pinch.clientY + (from.y - pinch.clientY) * scale).toBeCloseTo(to.y);
});

it('leaves a map that is readable already', () => {
  expect(readablePinch(0.9, false, { from, to })).toBeUndefined();
  expect(readablePinch(1, true, { from, to })).toBeUndefined();
});

describe('opening a map', () => {
  let portal: HTMLElement;
  let pinches: number;

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no DOMMatrix; a map fitted at 0.2.
    vi.stubGlobal(
      'DOMMatrix',
      class {
        a = 0.2;
      },
    );
    portal = document.createElement('div');
    portal.innerHTML =
      '<div class="react-flow__renderer"><div class="react-flow__viewport"><div class="react-flow__node"></div></div></div>';
    pinches = 0;
    portal.querySelector('.react-flow__renderer')!.addEventListener('wheel', (event) => {
      if (event instanceof WheelEvent && event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        pinches += 1;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pinches once, when the fit has settled', () => {
    openReadable(portal, PADDING);
    vi.advanceTimersByTime(300);
    expect(pinches).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(pinches).toBe(1);
  });

  it.each([
    ['a drag', () => new Event('pointerdown')],
    ['a zoom', () => new WheelEvent('wheel', { ctrlKey: true })],
  ])('leaves the map to a reader who moved it first with %s', (_, input) => {
    openReadable(portal, PADDING);
    portal.dispatchEvent(input());
    vi.advanceTimersByTime(5000);
    expect(pinches).toBe(0);
  });

  it('still opens readable when the reader scrolls the page past it', () => {
    openReadable(portal, PADDING);
    portal.dispatchEvent(new WheelEvent('wheel'));
    vi.advanceTimersByTime(5000);
    expect(pinches).toBe(1);
  });

  it('stops looking for a map that is never drawn', () => {
    portal.innerHTML = '';
    openReadable(portal, PADDING);
    vi.advanceTimersByTime(11_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
