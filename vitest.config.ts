import { defineConfig } from 'vitest/config';
import { polishCoverageThresholds } from './scripts/gates.ts';

export default defineConfig({
  test: {
    // Product tests only. The framework's self-tests (test/**) are a separate
    // suite — `pnpm test:framework` (vitest.framework.config.ts) — because
    // they plant probes in the live repo and spawn nested verify runs, which
    // races feature-work verify. CI runs them when framework files change.
    include: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts'],
      exclude: ['src/modules/**/__tests__/**', 'src/modules/**/*.{test,spec}.ts'],
      // Coverage floor on src/modules/**. verify fails below it.
      // ponytail: start at 80, ratchet up as modules mature — raise the
      // numbers here, never lower them to make a change pass (the ratchet
      // step enforces this for all four floors against origin/main).
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Polish-lane modules (gates: "polish" in module-map.json) get a
        // zero floor but stay measured/reported — all other checks apply.
        // ratchet parses the four global floors above; keep them first.
        ...polishCoverageThresholds(),
      },
    },
  },
});
