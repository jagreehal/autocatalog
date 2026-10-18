import { defineConfig } from 'vitest/config';

export default defineConfig({
  // These tests spawn git and build projects, which Windows runners do slowly.
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
