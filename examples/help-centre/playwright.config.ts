import { defineConfig, devices } from '@playwright/test';

const port = process.env.AUTOCATALOG_HELP_CENTRE_E2E_PORT ?? '4326';

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
      { formats: ['markdown'], outputDir: 'reports/stories', outputName: 'help-centre-e2e' },
    ],
  ],
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    // The server build, as it ships, with no model: the stories leave the assistant out.
    command: `pnpm build && HOST=127.0.0.1 PORT=${port} node dist/server.mjs`,
    url: `${baseURL}/help-centre/getting-started/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
