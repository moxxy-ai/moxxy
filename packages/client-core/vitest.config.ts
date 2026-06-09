import { mergeConfig, defineConfig } from 'vitest/config';
import preset from '@moxxy/vitest-preset';

// The hook tests (useWorkflows.test.tsx) render through @testing-library/react,
// which needs a DOM — run this package's suite under jsdom. The pure logic tests
// (chatModel, step-flow, runner-retry, speech) are environment-agnostic.
export default mergeConfig(
  preset,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }),
);
