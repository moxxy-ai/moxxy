// Root ESLint flat config. Consumes the shared @moxxy/eslint-config (imported
// by path to avoid adding a workspace devDep + lockfile churn). The shared
// config already ignores dist/node_modules/.turbo/coverage.
import base from './tooling/eslint-config/index.js';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/dist/**',
      // Electron's main/preload bundle output — built artifacts, not source.
      '**/dist-electron/**',
      // Astro's generated content types.
      '**/.astro/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // CMake's output for the native Computer Use helpers (it writes files named *.ts).
      'packages/plugin-computer-control/native/**/build/**',
      '**/*.timestamp-*.mjs',
      // Other agents' isolated git worktrees — full repo copies; not ours to lint.
      '.claude/**',
      '**/.git/**',
    ],
  },
  ...base,
  // React surfaces (desktop renderer, Ink TUI) get the hooks rules. Both
  // are warnings so they guide without failing CI; the desktop already
  // carries intentional `eslint-disable-next-line react-hooks/exhaustive-deps`
  // directives, which this makes valid (the rule now exists).
  // A test removes what it made with removeDir / removeDirSync from
  // @moxxy/vitest-preset/fs, which wait out the moment Windows refuses to
  // remove a path still in use. A bare recursive rm failed the Windows test
  // job at random, a different test each time (docs/windows-parity.md).
  {
    files: ['**/*.test.{ts,tsx}', '**/*.fixture.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression:matches([callee.name=/^rm(Sync)?$/], [callee.property.name=/^rm(Sync)?$/]) > ObjectExpression > Property[key.name='recursive']",
          message:
            "Remove a test's files with removeDir / removeDirSync from '@moxxy/vitest-preset/fs': a bare recursive rm fails on Windows while the path is still in use (EBUSY, ENOTEMPTY, EPERM).",
        },
      ],
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
