import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default mergeConfig(
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  }),
  defineConfig({
    test: {
      globals: false,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'src-tauri/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test-setup.ts',
          'src/**/__fixtures__/**',
          'src/**/__mocks__/**',
          'src/main.tsx',
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
  }),
);
