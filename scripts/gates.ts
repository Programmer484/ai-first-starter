// Gate profiles: modules with `"gates": "polish"` or `"gates": "shell"` opt
// out of the coverage floor ONLY. Lint, boundaries, typecheck, knip, and
// scope-guard stay on for both. `shell` additionally caps non-test source
// lines (module-sync.ts) so a shell stays thin instead of growing into a
// real module.
import { readModuleMap } from './module-map.ts';

type Floor = { lines: number; functions: number; branches: number; statements: number };

// Single source of truth for the coverage floor (CLAUDE.md rule 7).
// scripts/ratchet.ts parses this block directly out of this file's text, so
// keep the shape (`export const COVERAGE_FLOOR = { lines: <number>, ... }`)
// intact. Bump these numbers to ratchet the floor up — never lower them to
// make a change pass; the ratchet step enforces that against origin/main.
export const COVERAGE_FLOOR: Floor = { lines: 80, functions: 80, branches: 80, statements: 80 };

const ZERO_FLOOR: Floor = { lines: 0, functions: 0, branches: 0, statements: 0 };

// Per-glob coverage threshold for EVERY module in the map: `full` modules get
// COVERAGE_FLOOR, `polish`/`shell` modules get a zero floor — still measured
// and reported, only the gate is zeroed. `mapPath` defaults to the real map.
// No env override (readModuleMap called without `useEnv`): this runs at
// vitest config-eval time, and a stray MODULE_MAP would silently swap the
// real coverage thresholds.
export function moduleCoverageThresholds(mapPath?: string): Record<string, Floor> {
  const map = readModuleMap(mapPath);
  return Object.fromEntries(
    map.modules.map((m) => [
      `src/modules/${m.name}/**`,
      m.gates === 'polish' || m.gates === 'shell' ? ZERO_FLOOR : COVERAGE_FLOOR,
    ]),
  );
}
