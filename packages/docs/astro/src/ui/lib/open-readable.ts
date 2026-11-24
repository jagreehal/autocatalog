// A domain card's title is 13px at full size; this draws it at about 12px.
const READABLE_ZOOM = 0.9;

interface Point {
  x: number;
  y: number;
}

/**
 * The pinch that zooms a map from `zoom` up to a readable size and brings the
 * drawing's top left corner, `from` on screen, to `to`. It is a Ctrl+wheel
 * event in pages: React Flow zooms by 2^-deltaY (ten times as strong on a
 * Mac) about the pointer, so the pointer goes where that zoom carries `from`
 * onto `to`. Nothing when the map is readable already.
 */
export function readablePinch(
  zoom: number,
  mac: boolean,
  { from, to }: { from: Point; to: Point },
): { deltaY: number; clientX: number; clientY: number } | undefined {
  if (zoom >= READABLE_ZOOM) {
    return undefined;
  }

  const scale = READABLE_ZOOM / zoom;

  return {
    deltaY: -Math.log2(scale) / (mac ? 10 : 1),
    clientX: (scale * from.x - to.x) / (scale - 1),
    clientY: (scale * from.y - to.y) / (scale - 1),
  };
}

const POLL_MS = 100;

const GIVE_UP_MS = 10_000;

// What a reader does to a map. Once they have, where it opens is theirs to choose.
const INPUTS = ['pointerdown', 'wheel', 'keydown'] as const;

/**
 * Zooms a map to a readable size once the visualiser has fitted it, unless the
 * reader moves it first. The visualiser answers a pinch, so this sends one.
 * Returns what cancels it.
 */
export function openReadable(
  portal: HTMLElement,
  padding: { top: string; left: string },
): () => void {
  let last: number | undefined;
  let still = 0;

  const deadline = performance.now() + GIVE_UP_MS;

  const stop = () => {
    clearInterval(timer);
    INPUTS.forEach((input) => portal.removeEventListener(input, moved, true));
  };

  const moved = (event: Event) => {
    // A wheel without Ctrl or Cmd scrolls the page past the map.
    if (!(event instanceof WheelEvent) || event.ctrlKey || event.metaKey) {
      stop();
    }
  };

  const timer = window.setInterval(() => {
    if (performance.now() > deadline) {
      stop();

      return;
    }

    const viewport = portal.querySelector('.react-flow__viewport');
    const pane = portal.querySelector('.react-flow__renderer');

    if (!viewport || !pane) {
      return;
    }

    const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;

    still = zoom === last ? still + 1 : 0;
    last = zoom;

    if (still < 3) {
      return;
    }

    stop();

    const box = pane.getBoundingClientRect();

    const nodes = [...portal.querySelectorAll('.react-flow__node')].map((node) =>
      node.getBoundingClientRect(),
    );

    const pinch = readablePinch(zoom, navigator.userAgent.includes('Mac'), {
      from: {
        x: Math.min(...nodes.map(({ left }) => left)),
        y: Math.min(...nodes.map(({ top }) => top)),
      },
      // The corner sits where the visualiser's own fit leaves it, clear of its controls.
      to: {
        x: box.left + Number.parseFloat(padding.left),
        y: box.top + Number.parseFloat(padding.top),
      },
    });

    if (pinch) {
      pane.dispatchEvent(
        new WheelEvent('wheel', {
          ...pinch,
          ctrlKey: true,
          deltaMode: WheelEvent.DOM_DELTA_PAGE,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, POLL_MS);

  INPUTS.forEach((input) =>
    portal.addEventListener(input, moved, { capture: true, passive: true }),
  );

  return stop;
}
