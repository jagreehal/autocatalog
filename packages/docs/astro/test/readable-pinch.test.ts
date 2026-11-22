import { expect, it } from 'vitest';
import { readablePinch } from '../src/ui/lib/visualiser';

const from = { x: 40, y: 190 };

const to = { x: 60, y: 100 };

it('zooms a map that opens too small up to a readable size, on a Mac and elsewhere', () => {
  for (const mac of [true, false]) {
    for (const zoom of [0.07, 0.14, 0.4]) {
      const pinch = readablePinch(zoom, mac, from, to);

      // React Flow's own reading of a Ctrl+wheel event in pages.
      const scale = 2 ** (-(pinch?.deltaY ?? 0) * (mac ? 10 : 1));

      expect(zoom * scale).toBeCloseTo(0.9);

      // Zoomed about the pointer, the drawing's corner lands where it was sent.
      expect((pinch?.clientX ?? 0) + (from.x - (pinch?.clientX ?? 0)) * scale).toBeCloseTo(to.x);
      expect((pinch?.clientY ?? 0) + (from.y - (pinch?.clientY ?? 0)) * scale).toBeCloseTo(to.y);
    }
  }
});

it('leaves a map that is readable already', () => {
  expect(readablePinch(0.9, false, from, to)).toBeUndefined();
  expect(readablePinch(1, true, from, to)).toBeUndefined();
});
