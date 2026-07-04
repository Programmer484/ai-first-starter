import { defineConfig } from 'vitest/config';
import { polishCoverageExcludes } from './scripts/gates.ts';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.ts', 'test/**/*.test.ts'],
    // Enforcement probes spawn eslint/knip subprocesses; give them headroom.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts'],
      exclude: [
        'src/modules/**/__tests__/**',
        'src/modules/**/*.{test,spec}.ts',
        // Polish-lane modules (gates: "polish" in module-map.json) skip the
        // coverage floor only — all other checks still apply.
        ...polishCoverageExcludes(),
      ],
      // Coverage floor on src/modules/**. verify fails below it.
      // ponytail: start at 70% lines, ratchet up as modules mature — raise
      // the number here, never lower it to make a change pass.
      thresholds: {
        lines: 70,
      },
    },
  },
});
