import { defineConfig } from 'vitest/config';

// Component tests (`*.dom.test.tsx`) opt into a DOM per file with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.dom.test.tsx'],
    environment: 'node',
    setupFiles: ['test/helpers/fast-check-setup.ts'],
  },
});
