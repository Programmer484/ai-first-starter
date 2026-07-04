// Gate profiles: modules with `"gates": "polish"` opt out of the coverage
// floor ONLY. Lint, boundaries, typecheck, knip, scope-guard stay on.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Coverage-exclude globs for polish modules. `mapPath` defaults to the env
// override (MODULE_MAP) or the real map, same convention as module-sync.
export function polishCoverageExcludes(mapPath?: string): string[] {
  const path = mapPath
    ? resolve(mapPath)
    : process.env.MODULE_MAP
      ? resolve(process.env.MODULE_MAP)
      : resolve(ROOT, 'module-map.json');
  const map = JSON.parse(readFileSync(path, 'utf8')) as {
    modules: Array<{ name: string; gates?: string }>;
  };
  return map.modules.filter((m) => m.gates === 'polish').map((m) => `src/modules/${m.name}/**`);
}
