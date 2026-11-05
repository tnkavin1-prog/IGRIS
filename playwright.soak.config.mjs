import { defineConfig } from '@playwright/test';

// A round is roughly 0.6 s. Budget generously so a long soak is not killed by
// the runner: 5 minutes of setup slack + 3 s per round.
const rounds = Number(process.env.SOAK_ROUNDS ?? 5);
const roundBudget = Number.isFinite(rounds) && rounds > 0 ? rounds : 5;
const timeout = 300_000 + roundBudget * 3_000; // 5 min slack + 3 s per round

export default defineConfig({
  testDir: './tests/soak',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout,
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
