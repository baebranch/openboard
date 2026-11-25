import { defineConfig } from 'vitest/config';

// Component tests (`*.dom.test.tsx`) opt into a DOM per file with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.dom.test.tsx'],
    environment: 'node',
    // Builds dist/validators.js once before the run (the host tests load it like the extension does).
    globalSetup: ['test/helpers/global-setup.ts'],
    setupFiles: ['test/helpers/fast-check-setup.ts'],
  },
});
