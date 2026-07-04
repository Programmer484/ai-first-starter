// Gate profiles: modules with `"gates": "polish"` opt out of the coverage
// floor ONLY. Lint, boundaries, typecheck, knip, scope-guard stay on.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Per-glob zero thresholds for polish modules: coverage is still measured
// and reported, only the gate is zeroed. `mapPath` defaults to the real
// map. No env override: this runs at vitest config-eval time, and a stray
// MODULE_MAP would silently swap the real coverage thresholds.
type Floor = { lines: number; functions: number; branches: number; statements: number };
export function polishCoverageThresholds(mapPath?: string): Record<string, Floor> {
  const path = resolve(mapPath ?? resolve(ROOT, 'module-map.json'));
  let map: { modules: Array<{ name: string; gates?: string }> };
  try {
    map = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `gates: cannot parse ${path} (${err instanceof Error ? err.message : err}) — fix module-map.json; \`pnpm verify\` (module-sync) diagnoses it`,
    );
  }
  return Object.fromEntries(
    map.modules
      .filter((m) => m.gates === 'polish')
      .map((m) => [
        `src/modules/${m.name}/**`,
        { lines: 0, functions: 0, branches: 0, statements: 0 },
      ]),
  );
}
