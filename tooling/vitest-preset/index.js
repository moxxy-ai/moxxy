import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Setup file every moxxy test project must load; see isolate.js. */
export const isolateSetupFile = fileURLToPath(new URL('./isolate.js', import.meta.url));

export const moxxyVitestPreset = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
    setupFiles: [isolateSetupFile],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
    },
  },
});

export default moxxyVitestPreset;
