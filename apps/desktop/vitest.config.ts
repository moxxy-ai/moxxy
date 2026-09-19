import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Two test environments coexist:
 *   - jsdom for renderer (React) tests under `src/`.
 *   - node for main-process tests under `electron/`.
 *
 * They are separate projects so each test file gets its environment without the
 * node tests paying for a fake DOM.
 */
const alias = {
  '@': path.resolve(__dirname, 'src'),
  '@shared': path.resolve(__dirname, 'electron/shared'),
};

const exclude = ['**/node_modules/**', '**/dist/**', '**/dist-electron/**'];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          globals: false,
          environment: 'jsdom',
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'main',
          globals: false,
          environment: 'node',
          include: ['electron/**/*.test.ts'],
          exclude,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/test-setup.ts',
        'electron/main/index.ts',
        'electron/preload/index.ts',
        'src/main.tsx',
      ],
    },
  },
});
