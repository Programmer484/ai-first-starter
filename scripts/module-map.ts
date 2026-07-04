// Single reader for module-map.json — the source of truth every gate derives
// from. Consolidates path resolution (was duplicated & divergent across 5+
// call sites) and wraps parse errors with one named, actionable message.
//
// Resolution: explicit `mapPath` wins → then MODULE_MAP env ONLY when a caller
// opts in with `useEnv` (module-sync and new-module honor it as their sandbox
// contract; gates deliberately does NOT — a stray env var must never swap the
// real coverage thresholds) → then the repo default.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export type ModuleMap = {
  modules: Array<{
    name: string;
    path: string;
    description?: string;
    allowedImports?: string[];
    gates?: string;
  }>;
};

export function moduleMapPath(mapPath?: string, useEnv = false): string {
  if (mapPath) return resolve(mapPath);
  if (useEnv && process.env.MODULE_MAP) return resolve(process.env.MODULE_MAP);
  return join(ROOT, 'module-map.json');
}

export function readModuleMap(mapPath?: string, useEnv = false): ModuleMap {
  const path = moduleMapPath(mapPath, useEnv);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `gates: cannot parse ${path} (${err instanceof Error ? err.message : err}) — fix module-map.json; \`pnpm verify\` (module-sync) diagnoses it`,
    );
  }
}
