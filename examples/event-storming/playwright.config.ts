import { defineConfig, devices } from '@playwright/test';

const port = process.env.AUTOCATALOG_STORM_E2E_PORT ?? '4326';

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
      { formats: ['markdown'], outputDir: 'reports/stories', outputName: 'event-storming-e2e' },
    ],
  ],
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    // The static build, as it ships, from a plain file server.
    command: `pnpm build && python3 -m http.server ${port} --bind 127.0.0.1 --directory dist`,
    url: `${baseURL}/flows/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
