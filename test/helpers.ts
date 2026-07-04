// Shared test scaffolding: one spawn wrapper, one unformatted-probe planter,
// and one sandboxed doctored-map module-sync harness. Migrated here from the
// near-identical copies that used to live in each test file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// One spawnSync wrapper: run a command from the repo root (override cwd/env/
// input via opts) and fold stdout+stderr into `out` — agents read both.
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string } = {},
): { status: number | null; out: string } {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

// Plant an unformatted `index.ts` in src/modules/<dirName> (the extra spaces
// fail the format check). Returns the probe dir; pair with cleanupProbe.
export function plantUnformattedProbe(dirName: string): string {
  const dir = join(ROOT, 'src/modules', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export const x =    1\n');
  return dir;
}

export function cleanupProbe(dirName: string): void {
  rmSync(join(ROOT, 'src/modules', dirName), { recursive: true, force: true });
}

type LooseMap = { modules: Array<Record<string, unknown>> };

// Sandboxed doctored-map harness: copy the real module-map, apply `mutate`,
// and run module-sync against it with a mirrored src root (freshly cleared of
// any stale roots) so folder-sync is satisfied independent of the real repo.
export function runModuleSyncWith(mutate: (map: LooseMap) => void): {
  status: number | null;
  out: string;
} {
  const map = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8')) as LooseMap;
  mutate(map);
  const tmp = mkdtempSync(join(tmpdir(), 'module-sync-'));
  const mapPath = join(tmp, 'module-map.json');
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
  const srcRoot = join(tmp, 'src-root');
  rmSync(srcRoot, { recursive: true, force: true });
  mkdirSync(join(srcRoot, 'src/modules'), { recursive: true });
  for (const m of map.modules) {
    if (typeof m.name === 'string')
      mkdirSync(join(srcRoot, 'src/modules', m.name), { recursive: true });
  }
  return run('node', ['scripts/module-sync.ts'], {
    env: { MODULE_MAP: mapPath, MODULE_SRC_ROOT: srcRoot },
  });
}
