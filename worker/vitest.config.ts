import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Foundation packages resolve to their TypeScript source (no dist emit in Phase 0 —
// there is no deployable app yet). Keep this list in sync with tsconfig.json `paths`.
const PACKAGES = [
  'contracts',
  'utils',
  'errors',
  'config',
  'logger',
  'metrics',
  'health',
  'flags',
  'di',
  'build-info',
  'control-plane',
  'runtime',
  'infra-contracts',
  'persistence',
  'artifact-store',
  'processing',
  'blueprint',
  'product',
  'manifest',
  'coordinator',
  'execution-adapter',
  'processor-sdk',
  'image-processors',
  'image-backend',
  'composition',
] as const;

const alias = Object.fromEntries(
  PACKAGES.map((name) => [`@workerv2/${name}`, resolve(rootDir, `packages/${name}/src/index.ts`)]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/index.ts'],
    },
  },
});
