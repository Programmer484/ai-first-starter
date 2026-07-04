// CI-only mutation gate (`pnpm mutation`) — too slow for local `pnpm verify`.
export default {
  mutate: ['src/modules/**/*.ts', '!src/modules/**/__tests__/**', '!src/modules/**/*.test.ts'],
  testRunner: 'vitest',
  // Explicit: pnpm's strict node_modules breaks Stryker's plugin auto-discovery.
  plugins: ['@stryker-mutator/vitest-runner'],
  reporters: ['clear-text', 'progress'],
  // break: ratchet upward as the score improves, like the coverage floor.
  thresholds: { high: 80, low: 70, break: 60 },
};
