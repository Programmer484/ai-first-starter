import { defineConfig } from 'vitest/config';
import { COVERAGE_FLOOR, moduleCoverageThresholds } from './scripts/gates.ts';

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
      // Coverage floor. The numbers live once, in scripts/gates.ts
      // (COVERAGE_FLOOR) — bump them there to ratchet up, never lower them to
      // make a change pass (the ratchet step enforces this against
      // origin/main). Spread globally too (kept for ratchet-parsing compat
      // and for any file outside src/modules/**), then a per-module glob for
      // every module in module-map.json: `full` -> COVERAGE_FLOOR again,
      // `polish`/`shell` -> zero (still measured/reported — only the gate is
      // zeroed). ratchet parses the four global floors above; keep them
      // first.
      thresholds: {
        ...COVERAGE_FLOOR,
        ...moduleCoverageThresholds(),
      },
    },
  },
});
