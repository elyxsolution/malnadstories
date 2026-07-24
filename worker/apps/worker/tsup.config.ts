import { defineConfig } from 'tsup';

/**
 * Build config for the deployable worker. tsup (esbuild) BUNDLES the app entry + every `@workerv2/*`
 * workspace library (all TypeScript source) into ONE self-contained ESM file, leaving only Node
 * built-ins external. The result (`dist/main.js`) runs with `node dist/main.js` and needs NO
 * node_modules at runtime — which is what keeps the Docker/Render image tiny. Only the application
 * emits build artifacts; the libraries stay `--noEmit`.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  // esbuild externalizes `dependencies` by default; the @workerv2/* workspace libraries ship raw
  // TypeScript source (no build), so they MUST be inlined into the bundle instead — this is what
  // makes `dist/main.js` self-contained (only Node built-ins stay external).
  noExternal: [/^@workerv2\//],
  clean: true,
  sourcemap: true,
  dts: false,
  outDir: 'dist',
});
