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
  // Artifact platform (Phase 5 task / frozen Phase 3 byte store): the concrete content-addressed,
  // write-once byte ArtifactStore + registry + integrity + provenance on the Phase 3 contracts.
  // Depends on the foundation leaves + control-plane (value objects for provenance) +
  // infra-contracts. The DOMAIN never depends on this package; storage stays replaceable.
  'artifact-store': ['contracts', 'utils', 'errors', 'control-plane', 'infra-contracts'],
  // Processing framework (Phase 6 task): the generic DECLARATIVE processing model (steps,
  // pipelines, plans, context, policies, processor contracts) — pure data + pure functions,
  // no execution engine. Depends on the foundation leaves + control-plane (RunId/Timestamp
  // value objects) + infra-contracts (StorageKey — artifact-centric I/O). Deliberately does
  // NOT depend on runtime: capability requirements are structurally compatible instead, so
  // any engine can consume pipelines without the hosting framework.
  processing: ['contracts', 'utils', 'errors', 'control-plane', 'infra-contracts'],
  // Blueprint Platform (Phase 7 task / frozen Blueprint phase's model+compiler): the immutable,
  // content-addressable album production representation. Depends on the foundation leaves +
  // control-plane (AlbumId) + infra-contracts (StorageKey — artifact-centric references).
  // NO storage/runtime/processing dependency: hashing is local (same sha256:<hex> format as
  // the artifact platform — asserted compatible by tests, not by import).
  blueprint: ['contracts', 'utils', 'errors', 'control-plane', 'infra-contracts'],
  // Product Platform (Phase 8 task / frozen Product phase's definition + resolution core):
  // immutable versioned product definitions, catalogs, constraints, capabilities, hashing,
  // the resolver chain, and the compatibility model. Depends on the foundation leaves +
  // control-plane (VersionComponent — INV-11 pins) + blueprint (the BlueprintSource source
  // vocabulary ONLY — resolution PRODUCES the compiler's input). The dependency direction is
  // product -> blueprint; blueprint stays independent of catalog internals (no reverse import).
  product: ['contracts', 'utils', 'errors', 'control-plane', 'blueprint'],
  // Manifest Platform (Phase 9 task / frozen Manifest phase): the immutable, content-addressable
  // description of EXECUTABLE WORK derived from a blueprint. Depends on the foundation leaves +
  // control-plane (AlbumId) + infra-contracts (StorageKey) + blueprint (the compiler CONSUMES
  // blueprints) + processing (REUSED contracts: StepId, ArtifactInputBinding, policies,
  // capability requirements, orderStepGraph — no duplication). NO runtime/storage dependency;
  // the manifest describes work, an engine (later phase) executes it.
  manifest: [
    'contracts',
    'utils',
    'errors',
    'control-plane',
    'infra-contracts',
    'processing',
    'blueprint',
  ],
  // Coordinator Platform (Phase 10 task / frozen Phase 9 remainder — Coordinator/engine): the
  // deterministic execution coordinator that orchestrates Manifest/Pipeline execution. Depends
  // on the foundation leaves + control-plane (RunId/Timestamp/VersionSet + the reused RUN_MACHINE
  // + the state-machine engine) + infra-contracts (StorageKey) + processing (REUSED declarative
  // model: ExecutionPlan, policies, planFailureAction, ProcessingContext, ProcessorResolver,
  // orderStepGraph) + manifest (consumes a Manifest via its lossless pipeline bridge). NO runtime
  // (any engine drives it), NO storage/persistence/artifact-store (no I/O), NO queue/network/timers.
  coordinator: [
    'contracts',
    'utils',
    'errors',
    'control-plane',
    'infra-contracts',
    'processing',
    'manifest',
  ],
  // Execution Adapter (Phase 11 task): the INFRASTRUCTURE adapter that drives the pure
  // Coordinator — effect loop, processor dispatch/resolution, capability negotiation, session
  // (persist journal + publish events), tick driver, and pre-flight validation. This is the
  // side-effect layer, so it may depend "outward" on the coordinator + runtime (the reserved
  // CapabilityNegotiator contracts) + processing (processor/context/policies) + control-plane
  // (RunId/Timestamp) + infra-contracts (StorageKey). It implements NO processor and NO storage/
  // DB/queue/network — those are injected through its replaceable interfaces. Nothing depends on
  // this package (it is a top-level driver).
  'execution-adapter': [
    'contracts',
    'utils',
    'errors',
    'control-plane',
    'infra-contracts',
    'processing',
    'runtime',
    'coordinator',
  ],
  // Processor SDK (Phase 12 task): the reusable framework future concrete processors are BUILT
  // with — base processor + lifecycle, reusable context, artifact-access ports, progress,
  // diagnostics, resource guards, validation, and a test harness. It sits UPSTREAM of the engine:
  // it produces `Processor`s (the processing contract) but depends on NO coordinator/adapter/
  // runtime. Depends on the foundation leaves + control-plane (RunId/Timestamp) + infra-contracts
  // (StorageKey/ArtifactKind CONTRACTS only — no storage impl) + processing (the Processor/context
  // contracts it implements against). Implements no concrete processor and no rendering.
  'processor-sdk': [
    'contracts',
    'utils',
    'errors',
    'control-plane',
    'infra-contracts',
    'processing',
  ],
  // Image Foundation Processors (Phase 13 task / frozen Image phase foundation, M7 partial): the
  // first CONCRETE processors — generic image normalization + metadata extraction — built WITH the
  // Processor SDK. Depends on the foundation leaves + control-plane (RunId/Timestamp value objects,
  // via the SDK context) + infra-contracts (StorageKey/ArtifactKind CONTRACTS only) + processing
  // (the Processor/context/failure contracts) + processor-sdk (the base processor + harness). Pure
  // TypeScript image-container parsing — NO native codec, NO storage impl, NO rendering/PDF/layout,
  // NO album knowledge. Nothing depends on this package (it produces `Processor`s a host registers).
  'image-processors': [
    'contracts',
    'utils',
    'errors',
    'control-plane',
    'infra-contracts',
    'processing',
    'processor-sdk',
  ],
  // Native Image Backend (Phase 14 task / frozen Image phase pixel backend): the replaceable,
  // framework-independent pixel-processing backend future image processors use for DETERMINISTIC
  // transformations (decode/resize/rotate/crop/ICC-convert/validate) + the Pixel Gateway that
  // produces immutable, content-addressed raster Artifacts + a pure-TS deterministic reference
  // backend + a reusable contract-test harness. Depends ONLY on the foundation leaves +
  // infra-contracts (StorageKey — the Pixel Gateway's artifact port is structurally compatible
  // with the SDK's ArtifactGateway, NOT imported). NO processor-sdk/processing/coordinator/
  // manifest/blueprint/runtime dependency: the backend is a low-level pixel engine, not a
  // processor or an orchestrator. No album/render/PDF/product logic. Nothing here depends on this
  // package yet (image processors will consume it via the gateway).
  'image-backend': ['contracts', 'utils', 'errors', 'infra-contracts'],
  // Page Composition Engine (Phase 15 task / frozen Render phase compositor half): the
  // deterministic compositor that transforms Blueprint surfaces + normalized image Artifacts into
  // rendered page Artifacts (layer stack, transform application, masks, clipping, frames,
  // background fills, z-ordering, minimal blend modes, page rasterization, composition validation).
  // Depends on the foundation leaves + infra-contracts (StorageKey) + blueprint (the SURFACE data it
  // composes) + image-backend (the ImageBackend it runs pixel work through + the Pixel Gateway/byte
  // port it produces page rasters with — future GPU acceleration lives behind that backend). NO PDF
  // generation, NO album packaging, NO vendor/printing logic, NO storage of its own, NO
  // coordinator/manifest/product dependency. Nothing depends on this package yet (a later render
  // processor / assemble stage will).
  composition: ['contracts', 'utils', 'errors', 'infra-contracts', 'blueprint', 'image-backend'],
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
