import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/soak',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 180_000,
  expect: { timeout: 30_000 },
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
