import { defineConfig } from '@playwright/test';

/**
 * Extension tests need a real Chromium with the unpacked build loaded. The
 * extension is built once in global setup so a stale `release/` can never make
 * a passing test meaningless.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: false,
    viewport: { width: 440, height: 940 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
