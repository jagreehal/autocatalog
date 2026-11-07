import { defineConfig, devices } from '@playwright/test';

const port = process.env.AUTOCATALOG_SITE_E2E_PORT ?? '4325';

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    [
      'executable-stories-playwright/reporter',
      { formats: ['markdown'], outputDir: 'reports/stories', outputName: 'site-extension-e2e' },
    ],
  ],
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    // The server build, as it ships: per-request pages behind the site's middleware.
    command: `pnpm build && HOST=127.0.0.1 PORT=${port} node dist/server.mjs`,
    url: `${baseURL}/site-extension/guide/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
});
