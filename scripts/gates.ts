// Gate profiles: modules with `"gates": "polish"` opt out of the coverage
// floor ONLY. Lint, boundaries, typecheck, knip, scope-guard stay on.
import { readModuleMap } from './module-map.ts';

// Per-glob zero thresholds for polish modules: coverage is still measured
// and reported, only the gate is zeroed. `mapPath` defaults to the real
// map. No env override (readModuleMap called without `useEnv`): this runs at
// vitest config-eval time, and a stray MODULE_MAP would silently swap the
// real coverage thresholds.
type Floor = { lines: number; functions: number; branches: number; statements: number };
export function polishCoverageThresholds(mapPath?: string): Record<string, Floor> {
  const map = readModuleMap(mapPath);
  return Object.fromEntries(
    map.modules
      .filter((m) => m.gates === 'polish')
      .map((m) => [
        `src/modules/${m.name}/**`,
        { lines: 0, functions: 0, branches: 0, statements: 0 },
      ]),
  );
}
