import { defineConfig } from 'vitest/config';

// Perf suite: NOT part of `npm test`. Run with `npm run test:perf` (PERF_STRICT=1 for exact budgets).
export default defineConfig({
  test: {
    include: ['test/perf/**/*.perf.ts'],
    environment: 'node',
    globalSetup: ['test/perf/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
