import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * APP-SIDE DURABLE REGRESSION SUITE.
 *
 * The project already standardises on Vitest (the worker runs 141 files / 1220 tests under it);
 * this is the same runner extended to the Next app, NOT a second framework. The worker workspace
 * stays self-contained — it imports no app source and its boundary check enforces that — so
 * commerce tests could not live there without coupling a deployable service to the web app.
 *
 * TWO ALIASES, both test-only and neither a production seam:
 *   `@/…`         mirrors the tsconfig path mapping Next resolves at build time.
 *   `server-only` is a compiler marker Next substitutes during the build; it has no runtime
 *                 implementation to import outside Next, so it resolves to an empty stub. This
 *                 changes nothing about which code runs — the modules under test are the real
 *                 production modules, unmodified.
 *
 * Every test in this suite is pure: no database, no network, no fixtures. The only Postgres this
 * repository can reach is PRODUCTION, so database-level guarantees (RLS, the atomic cart
 * increment, the money re-checks in `create_order_with_items`, the TRUNCATE revoke) are verified
 * against the live catalog during the phase work and are deliberately NOT re-run here. See
 * tests/README.md for what that leaves uncovered and why.
 */
export default defineConfig({
  // Next compiles components with the automatic JSX runtime, so component files do not import
  // React. Match that here, otherwise rendering a real component fails on `React is not defined`.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
      'server-only': resolve(rootDir, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**'],
    environment: 'node',
    globals: false,
    clearMocks: true,
  },
});
