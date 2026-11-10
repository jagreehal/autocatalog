import { defineConfig, devices } from '@playwright/test';

const port = process.env.AUTOCATALOG_PUBLIC_API_E2E_PORT ?? '4327';

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
      { formats: ['markdown'], outputDir: 'reports/stories', outputName: 'public-api-e2e' },
    ],
  ],
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    // The server build, as it ships: its assistant needs one.
    command: `pnpm build && HOST=127.0.0.1 PORT=${port} node dist/server.mjs`,
    url: `${baseURL}/apis/public-api/openapi/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
