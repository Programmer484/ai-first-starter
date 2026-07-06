// Meta-tests for the polish gate profile: modules with `"gates": "polish"`
// in module-map.json are exempt from the coverage floor ONLY.
// Same doctored-map pattern as module-map-validation.test.ts — temp-dir maps
// via MODULE_MAP / MODULE_SRC_ROOT, never the shared repo state.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { polishCoverageThresholds } from '../scripts/gates.ts';
import { runModuleSyncWith } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_MAP = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8'));

const tmp = mkdtempSync(join(tmpdir(), 'gate-profiles-'));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

type LooseMap = { modules: Array<Record<string, unknown>> };
function writeMap(mutate: (map: LooseMap) => void): string {
  const map = JSON.parse(JSON.stringify(REAL_MAP));
  mutate(map);
  mkdirSync(tmp, { recursive: true });
  const mapPath = join(tmp, 'module-map.json');
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
  return mapPath;
}

const ZERO_FLOOR = { lines: 0, functions: 0, branches: 0, statements: 0 };

// Expected helper output for a map: one zero-floor glob per polish module.
// Derived, not hard-coded, so the repo map may gain/lose polish modules
// without stranding these meta-tests.
function expectedPolishEntries(map: LooseMap): Record<string, typeof ZERO_FLOOR> {
  return Object.fromEntries(
    map.modules
      .filter((m) => m.gates === 'polish')
      .map((m) => [`src/modules/${m.name as string}/**`, ZERO_FLOOR]),
  );
}

describe('gates helper (polishCoverageThresholds)', () => {
  it('returns a zero-floor entry for a polish module and nothing for full/absent', () => {
    const mapPath = writeMap((map) => {
      map.modules.push(
        { name: 'zz_gates_polish', gates: 'polish' },
        { name: 'zz_gates_full', gates: 'full' },
        { name: 'zz_gates_absent' },
      );
    });
    const result = polishCoverageThresholds(mapPath);
    expect(result['src/modules/zz_gates_polish/**']).toEqual(ZERO_FLOOR);
    expect(result).not.toHaveProperty('src/modules/zz_gates_full/**');
    expect(result).not.toHaveProperty('src/modules/zz_gates_absent/**');
    expect(result).toEqual(
      expectedPolishEntries(JSON.parse(readFileSync(mapPath, 'utf8')) as LooseMap),
    );
  });

  it('returns exactly one zero-floor entry per polish module in the repo map', () => {
    expect(polishCoverageThresholds(join(ROOT, 'module-map.json'))).toEqual(
      expectedPolishEntries(REAL_MAP as LooseMap),
    );
  });
});

describe('module-sync gates validation', () => {
  it('accepts `"gates": "polish"` with no unknown-key warning', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.gates = 'polish';
    });
    expect(status).toBe(0);
    expect(out).not.toContain('unknown key');
  });

  it('rejects an invalid gates value, naming full | polish', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.gates = 'sometimes';
    });
    expect(status).toBe(1);
    expect(out).toContain('full | polish');
  });
});

describe('new-module --gates', () => {
  function runNewModule(args: string[]) {
    const mapPath = writeMap(() => {});
    const srcRoot = join(tmp, 'scaffold-root');
    mkdirSync(srcRoot, { recursive: true });
    const res = spawnSync('node', ['scripts/new-module.ts', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, MODULE_MAP: mapPath, MODULE_SRC_ROOT: srcRoot },
    });
    return { status: res.status, map: JSON.parse(readFileSync(mapPath, 'utf8')) as LooseMap };
  }

  it('writes gates: "polish" into the map entry with --gates polish', () => {
    const { status, map } = runNewModule(['zz_gates_scaffold', '--gates', 'polish']);
    expect(status).toBe(0);
    const entry = map.modules.find((m) => m.name === 'zz_gates_scaffold');
    expect(entry?.gates).toBe('polish');
  });

  it('writes no gates key without the flag', () => {
    const { status, map } = runNewModule(['zz_gates_plain']);
    expect(status).toBe(0);
    const entry = map.modules.find((m) => m.name === 'zz_gates_plain');
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('gates');
  });

  it('rejects an invalid --gates value with exit 2', () => {
    const res = spawnSync('node', ['scripts/new-module.ts', 'zz_gates_bad', '--gates', 'never'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, MODULE_MAP: join(tmp, 'nope.json'), MODULE_SRC_ROOT: tmp },
    });
    expect(res.status).toBe(2);
    expect((res.stderr ?? '') + (res.stdout ?? '')).toContain('full|polish');
  });
});

describe('vitest config wiring', () => {
  it('keeps baseline excludes and global floors first in thresholds', async () => {
    const config = (await import('../vitest.config.ts')).default as {
      test: { coverage: { exclude: string[]; thresholds: Record<string, unknown> } };
    };
    expect(config.test.coverage.exclude).toEqual([
      'src/modules/**/__tests__/**',
      'src/modules/**/*.{test,spec}.ts',
    ]);
    const thresholds = config.test.coverage.thresholds;
    // ratchet regex-parses the first four floors after `thresholds`; the
    // globals must stay first and per-glob polish entries come after.
    expect(Object.keys(thresholds).slice(0, 4)).toEqual([
      'lines',
      'functions',
      'branches',
      'statements',
    ]);
    // The floor VALUE is pinned by the ratchet, not by this meta-test —
    // assert the shape: four numeric global floors, then exactly the
    // per-glob polish entries generated from the repo map, nothing else.
    const floors = Object.fromEntries(
      ['lines', 'functions', 'branches', 'statements'].map((k) => [k, thresholds[k]]),
    );
    for (const v of Object.values(floors)) expect(typeof v).toBe('number');
    expect(thresholds).toEqual({
      ...floors,
      ...polishCoverageThresholds(join(ROOT, 'module-map.json')),
    });
  });
});
