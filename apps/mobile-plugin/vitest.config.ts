import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The session gateway specs open real HTTP/WS servers and run alongside the
    // whole monorepo in `pnpm test`, where CI/local CPU contention can push
    // otherwise healthy integration cases past Vitest's default-sized window.
    testTimeout: 30000,
  },
});
