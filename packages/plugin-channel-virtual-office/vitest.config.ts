import { mergeConfig } from 'vitest/config';
import preset from '@moxxy/vitest-preset';

// Automatic JSX runtime so frontend .tsx modules can be exercised in tests.
export default mergeConfig(preset, {
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
});
