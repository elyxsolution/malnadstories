#!/usr/bin/env node
// Architectural boundary + cycle enforcement for the Worker V2 foundation.
//
// This is the AUTHORITATIVE check for dependency direction (Engineering Playbook
// §4.1.5 "no circular dependencies", §5.4 import rules). It verifies, for every
// foundation package:
//   1. every `@workerv2/*` import is in the package's ALLOWED dependency set;
//   2. every `@workerv2/*` import is declared in the package's package.json;
//   3. the package-dependency graph is acyclic.
//
// Zero runtime dependencies (Node fs + regex) so it can run anywhere, anytime.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(rootDir, 'packages');
const SCOPE = '@workerv2/';

// Allowed intra-foundation dependencies. Enforces dependency inversion: leaves
// (contracts/utils/errors) depend on nothing but each other's lower layers;
// primitives depend only on those leaves. Product knowledge is forbidden here.
const ALLOWED = {
  contracts: [],
  utils: ['contracts'],
  errors: ['contracts'],
  config: ['contracts', 'errors', 'utils'],
  logger: ['contracts', 'utils'],
  metrics: ['contracts'],
  health: ['contracts', 'utils'],
  flags: ['contracts'],
  di: ['contracts', 'errors', 'utils'],
  'build-info': ['contracts'],
  // Control Plane DOMAIN (Phase 1): pure, framework-independent. Depends only on the
  // foundation leaves — never on runtime/infrastructure packages.
  'control-plane': ['contracts', 'utils', 'errors'],
  // Worker Runtime (Phase 2): the hosting framework. Depends inward on the foundation
  // packages and on control-plane for GENERIC contracts only (state-machine engine +
  // technical-event model) — never on domain aggregates/lifecycles/policies.
  runtime: [
    'contracts',
    'utils',
    'errors',
    'di',
    'config',
    'health',
    'build-info',
    'logger',
    'control-plane',
  ],
  // Infrastructure contracts (Phase 3): the abstraction seam between the pure domain and
  // future infrastructure. Depends inward on the foundation leaves + control-plane (domain
  // types + technical-event model). NO concrete storage/DB — contracts + DTOs + mappers only.
  'infra-contracts': ['contracts', 'utils', 'errors', 'control-plane'],
  // Persistence engine (Phase 4): the concrete in-memory State Store implementing the Phase 3
  // contracts. Depends on the foundation leaves + control-plane + infra-contracts. The DOMAIN
  // never depends on this package (persistence stays independent of the domain).
  persistence: ['contracts', 'utils', 'errors', 'control-plane', 'infra-contracts'],
};

/** Recursively collect .ts source files under a directory. */
function collectTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:from|import)\s+['"]@workerv2\/([a-z-]+)['"]/g;

const violations = [];
const graph = new Map();

const pkgDirs = readdirSync(packagesDir).filter((d) =>
  statSync(join(packagesDir, d)).isDirectory(),
);

for (const pkg of pkgDirs) {
  if (!(pkg in ALLOWED)) {
    violations.push(`Unknown package "${pkg}" — add it to ALLOWED in check-boundaries.mjs.`);
    continue;
  }
  const allowed = new Set(ALLOWED[pkg]);
  const pkgJson = JSON.parse(readFileSync(join(packagesDir, pkg, 'package.json'), 'utf8'));
  const declared = new Set(
    Object.keys(pkgJson.dependencies ?? {})
      .filter((d) => d.startsWith(SCOPE))
      .map((d) => d.slice(SCOPE.length)),
  );

  const imported = new Set();
  for (const file of collectTsFiles(join(packagesDir, pkg, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const dep = match[1];
      imported.add(dep);
      if (dep === pkg) violations.push(`${pkg}: imports itself via ${SCOPE}${dep}.`);
      else if (!allowed.has(dep))
        violations.push(
          `${pkg}: FORBIDDEN import of ${SCOPE}${dep} (allowed: [${[...allowed].join(', ') || 'none'}]).`,
        );
      else if (!declared.has(dep))
        violations.push(
          `${pkg}: imports ${SCOPE}${dep} but does not declare it in package.json dependencies.`,
        );
    }
  }
  graph.set(pkg, imported);
}

// Cycle detection (DFS with colouring) over the package-dependency graph.
const WHITE = 0;
const GREY = 1;
const BLACK = 2;
const colour = new Map([...graph.keys()].map((k) => [k, WHITE]));

function visit(node, stack) {
  colour.set(node, GREY);
  for (const next of graph.get(node) ?? []) {
    if (!graph.has(next)) continue;
    if (colour.get(next) === GREY) {
      violations.push(`CYCLE detected: ${[...stack, node, next].join(' -> ')}`);
    } else if (colour.get(next) === WHITE) {
      visit(next, [...stack, node]);
    }
  }
  colour.set(node, BLACK);
}

for (const node of graph.keys()) {
  if (colour.get(node) === WHITE) visit(node, []);
}

if (violations.length > 0) {
  console.error('✖ Architectural boundary violations:\n');
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(`✓ Boundaries OK — ${graph.size} packages, no forbidden deps, no cycles.`);
