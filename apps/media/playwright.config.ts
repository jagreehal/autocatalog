import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The example sites, each built as it ships and served on a port of its own.
export const SITES = {
  docs: 'http://127.0.0.1:4441',
  storm: 'http://127.0.0.1:4442',
  api: 'http://127.0.0.1:4443',
} as const;

// `pnpm media` sets DEMO: a visible cursor, human pace, and each frame held long
// enough to read; the GIFs are made from the run. Without it the journeys run fast
// and unrecorded, as a check that every one still passes.
const DEMO = Boolean(process.env.DEMO);

const REPORTS = path.join(import.meta.dirname, DEMO ? 'reports' : 'test-results/stories');

const examples = path.join(import.meta.dirname, '../../examples');

export default defineConfig<{ demo: boolean }>({
  testDir: './journeys',
  fullyParallel: !DEMO,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['list'],
    [
      'executable-stories-playwright/reporter',
      {
        formats: ['story-report-json'],
        outputDir: REPORTS,
        rawRunPath: path.join(REPORTS, 'raw-run.json'),
      },
    ],
  ],
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command: `pnpm --dir ${examples}/docs-demo build && pnpm --dir ${examples}/docs-demo preview --host 127.0.0.1 --port 4441 --ignore-lock`,
      url: SITES.docs,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
    {
      command: `pnpm --dir ${examples}/event-storming build && python3 -m http.server 4442 --bind 127.0.0.1 --directory ${examples}/event-storming/dist`,
      url: `${SITES.storm}/flows/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
    {
      command: `pnpm --dir ${examples}/public-api build && HOST=127.0.0.1 PORT=4443 node ${examples}/public-api/dist/server.mjs`,
      url: `${SITES.api}/apis/public-api/openapi/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(DEMO && { launchOptions: { slowMo: 250 }, demo: true }),
      },
      ...(DEMO && { timeout: 120_000, expect: { timeout: 15_000 } }),
    },
  ],
});
