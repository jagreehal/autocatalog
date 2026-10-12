import { defineConfig, devices } from '@playwright/test';

const port = process.env.AUTOCATALOG_DOCS_E2E_PORT ?? '4324';

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
      { formats: ['markdown'], outputDir: 'reports/stories', outputName: 'docs-e2e' },
    ],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    // Built and previewed, not `dev`: the search index is a build artifact, so
    // the dev server cannot answer the question these stories exist to ask.
    // `--ignore-lock` keeps the server in the foreground, where Playwright can
    // stop it: Astro otherwise backgrounds a preview an AI agent starts.
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
