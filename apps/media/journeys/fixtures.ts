import path from 'node:path';
import { test as base, type Locator } from '@playwright/test';
import { story } from 'executable-stories-playwright';
import { showCursor } from 'executable-stories-showcase/playwright';

export { expect } from '@playwright/test';

// Stills for the README and the docs land beside them, named for where they are used.
const MEDIA = path.join(import.meta.dirname, '../../../docs/media');

// The recorded cursor belongs in the GIFs, not in a still.
const NO_CURSOR = '.es-cursor, .es-ripple { display: none !important; }';

interface FrameOptions {
  /** What the frame points at: ringed in the storyboard. */
  highlight?: Locator;
  /** Also saved as `docs/media/<name>-light.png` and `-dark.png`, when recording. */
  still?: string;
}

type Fixtures = {
  /** Set by `pnpm media`: a visible cursor and frames saved for the docs. */
  demo: boolean;
  /**
   * A storyboard frame: the step's screenshot, for the report and the GIF made
   * from it, and, with `still`, a still of the page in both themes for the docs.
   */
  frame: (alt: string, options?: FrameOptions) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  demo: [false, { option: true }],

  page: async ({ page, demo }, use) => {
    if (demo) await showCursor(page, { pointer: 'arrow', color: '#171717', glide: 450 });

    await use(page);
  },

  frame: async ({ page, demo }, use) =>
    use(async (alt, { highlight, still } = {}) => {
      await story.screenshot({ page, alt, ...(highlight && { highlight }) });

      if (!demo || !still) return;

      const root = page.locator('html');

      const theme = await root.getAttribute('data-theme');

      for (const mode of ['light', 'dark'] as const) {
        await root.evaluate((element, next) => (element.dataset.theme = next), mode);
        // The map and the theme's colour transitions follow a moment later.
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(MEDIA, `${still}-${mode}.png`), style: NO_CURSOR });
      }

      await root.evaluate((element, previous) => {
        if (previous) element.dataset.theme = previous;
      }, theme);
    }),
});
