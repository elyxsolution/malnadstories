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
  // esbuild externalizes `dependencies` by default; we INLINE them so `dist/` stays self-contained
  // (no node_modules at runtime):
  //   • the @workerv2/* workspace libraries ship raw TypeScript source (no build), so they must be
  //     inlined;
  //   • the production infrastructure SDKs (pg-boss / postgres / aws-sdk) are inlined too. They are
  //     reached only through a DYNAMIC import gated on `WV2_INFRA=on`, so esbuild code-splitting keeps
  //     them out of the default-boot chunk — the infra-less worker never loads them.
  noExternal: [/^@workerv2\//, 'pg-boss', 'postgres', '@aws-sdk/client-s3'],
  // External modules resolved from node_modules at runtime:
  //   • pg-native / cloudflare:sockets — environment-guarded, never required under Node (bundle guard);
  //   • sharp / heic-convert / libheif-js — NATIVE binary / WASM, not bundleable;
  //   • puppeteer — ships + drives a Chromium binary; must resolve from node_modules, not a bundle.
  //     These load ONLY inside the dynamically-imported processor chunk (WV2_INFRA=on), so the default
  //     worker never needs them; the production image ships them via node_modules (see Dockerfile).
  external: ['pg-native', 'cloudflare:sockets', 'sharp', 'heic-convert', 'libheif-js', 'puppeteer'],
  clean: true,
  sourcemap: true,
  dts: false,
  outDir: 'dist',
  splitting: true,
});
