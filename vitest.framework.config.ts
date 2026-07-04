import { defineConfig } from 'vitest/config';

// Framework self-tests: the enforcement probes and verify meta-tests under
// test/**. Deliberately OUTSIDE the default `pnpm verify` gate — they plant
// probe modules in the live repo, temporarily doctor shared state, and spawn
// nested verify/vitest runs, so running them alongside feature work causes
// races, not signal. Run via `pnpm test:framework`; CI runs them only when
// framework files (scripts/, hooks, configs, test/) change.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Probes spawn eslint/knip/verify subprocesses; give them headroom.
    testTimeout: 30_000,
  },
});
