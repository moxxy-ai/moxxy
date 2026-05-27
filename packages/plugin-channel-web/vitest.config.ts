import { mergeConfig } from 'vitest/config';
import preset from '@moxxy/vitest-preset';

// Enable the automatic JSX runtime so the browser frontend (.tsx) can be
// imported and exercised in tests via react-dom/server.
export default mergeConfig(preset, {
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
});
