import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Prefer top-level `import type`, but ALLOW inline `import('…').Type`
      // annotations (used deliberately for cycle avoidance / one-offs). Warn,
      // not error: this is a never-linted codebase — surface the style debt
      // without a flag-day mass rewrite; ratchet to error once cleaned.
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      'prefer-const': 'warn',
      // Pre-existing debt surfaced as warnings (don't block); ratchet to error later.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // New in @eslint/js 10 recommended.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-console': 'off',
      // Off where the rule conflicts with intentional, correct patterns:
      'no-control-regex': 'off', // ANSI / control-char handling (TUI, strip)
      'require-yield': 'off', // async-generator interface stubs (fakes/no-op modes)
      'no-undef': 'off', // redundant on TS; noisy on node globals in .cjs/.mjs
      '@typescript-eslint/triple-slash-reference': 'off', // /// <reference> needed for some d.ts
      '@typescript-eslint/no-require-imports': 'off', // .cjs config files
    },
  },
);
