import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in Node by default; the few suites that need DOM globals opt
 * in with `@vitest-environment happy-dom` at the top of the file.
 *
 * The `@gbl/shared` alias mirrors the tsconfig path mapping so tests exercise
 * the same source files the bundler consumes, not a stale build artifact.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@gbl/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: ['default'],
    // A handful of suites bind real loopback ports. One worker per core
    // exhausted the file-descriptor budget on busy machines and made those
    // binds fail intermittently, so the pool is capped.
    maxWorkers: 8,
    minWorkers: 1,
  },
});
