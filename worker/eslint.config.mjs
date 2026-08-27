// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Worker V2 foundation lint config (flat). Code-quality rules only — architectural
 * boundary + cycle enforcement lives in `scripts/check-boundaries.mjs` (run via
 * `pnpm run boundaries`), which is authoritative for dependency direction.
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The console logger is the one place a console sink is legitimate.
    files: ['packages/logger/src/console-logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Benchmark suites PRINT their reports — that is their deliverable. Confined to test files, so
    // no production module can smuggle a `console` call in under this exemption.
    files: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Operator DIAGNOSTICS print their findings to a terminal — that is the whole deliverable, the
    // same reason the existing CLIs under src/diagnostics/ do. Confined to `scripts/`, which is
    // excluded from the build (see tsup config) and imported by nothing.
    files: ['apps/*/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Config/build files run in a Node script context.
    files: ['*.config.ts', '*.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
