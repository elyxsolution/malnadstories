/**
 * `server-only` is a build-time marker package that Next replaces during compilation; it has no
 * importable runtime implementation outside the Next build, so the test runner aliases it here.
 * Importing it must be a no-op — this file exists so the REAL production modules (which correctly
 * declare `import 'server-only'`) can be loaded unmodified by the test runner.
 */
export {};
