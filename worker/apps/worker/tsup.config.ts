import { defineConfig } from 'tsup';

/**
 * Build config for the deployable worker. tsup (esbuild) BUNDLES the app entry + every `@workerv2/*`
 * workspace library (all TypeScript source) into ONE self-contained ESM file, leaving only Node
 * built-ins external. The result (`dist/main.js`) runs with `node dist/main.js` and needs NO
 * node_modules at runtime — which is what keeps the Docker/Render image tiny. Only the application
 * emits build artifacts; the libraries stay `--noEmit`.
 */
export default defineConfig({
  /**
   * ONE image, several entrypoints.
   *
   * `main.ts` is the long-running worker. The diagnostics CLIs are built alongside it because
   * the production image ships ONLY `dist/` — `src/` is never copied, and `tsx` is a
   * devDependency that `pnpm deploy --prod` strips. Without these entries the diagnostics
   * package scripts work on a developer machine and are simply absent in production, which
   * would make any documented production procedure fiction.
   *
   * They add no runtime behaviour to the worker: nothing in `main.ts` imports them, so the
   * long-running process never loads a byte of this code. They are separate executables that
   * happen to travel in the same image, invoked as `node dist/orphan-cleanup.js …`.
   */
  entry: [
    'src/main.ts',
    'src/diagnostics/orphan-scan/cli.ts',
    'src/diagnostics/orphan-cleanup/cli.ts',
    'src/diagnostics/preview-pdf-cleanup/cli.ts',
    'src/diagnostics/derivative-forensics/cli.ts',
    'src/diagnostics/account-assets/cli.ts',
  ],
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
  //   • `dotenv` is inlined too: env loading runs on the DEFAULT boot path, before any config is
  //     read, so leaving it external would break the "dist/main.js needs no node_modules" property.
  noExternal: [/^@workerv2\//, 'pg-boss', 'postgres', '@aws-sdk/client-s3', 'dotenv'],
  // External modules resolved from node_modules at runtime:
  //   • pg-native / cloudflare:sockets — environment-guarded, never required under Node (bundle guard);
  //   • sharp / heic-convert / libheif-js — NATIVE binary / WASM, not bundleable;
  //   • puppeteer — ships + drives a Chromium binary; must resolve from node_modules, not a bundle.
  //     These load ONLY inside the dynamically-imported processor chunk (WV2_INFRA=on), so the default
  //     worker never needs them; the production image ships them via node_modules (see Dockerfile).
  external: ['pg-native', 'cloudflare:sockets', 'sharp', 'heic-convert', 'libheif-js', 'puppeteer'],
  // ESM/CJS interop. `dotenv` is CommonJS and calls `require('fs')` internally. Inlining it into an
  // ESM bundle leaves esbuild's `__require` shim, which throws on any dynamic require — including
  // Node builtins. Defining a real `require` from `import.meta.url` gives inlined CJS dependencies a
  // working resolver. (Caught by running the built artifact, not by typecheck or tests.)
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  clean: true,
  sourcemap: true,
  dts: false,
  outDir: 'dist',
  splitting: true,
});
