import { defineConfig } from 'vitest/config';

/**
 * The live check against the real ChatGPT backend. Unlike the default preset it
 * does NOT move HOME to a temp dir: it must reach the developer's own vault
 * sign-in, and a refreshed token has to land back there or the old one dies.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test-live/**/*.live.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
