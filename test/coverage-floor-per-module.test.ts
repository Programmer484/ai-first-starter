// Meta-tests for per-module coverage thresholds (scripts/gates.ts):
// `moduleCoverageThresholds()` gives EVERY module in module-map.json its own
// glob threshold — COVERAGE_FLOOR for `full` (and absent, which defaults to
// full), zero for `polish`/`shell` — and a real vitest coverage run enforces
// it per module, not just globally.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleCoverageThresholds, COVERAGE_FLOOR } from '../scripts/gates.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_MAP = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8'));

const ZERO_FLOOR = { lines: 0, functions: 0, branches: 0, statements: 0 };

type LooseMap = { modules: Array<Record<string, unknown>> };

// Expected helper output for a map: one glob entry per module — COVERAGE_FLOOR
// for full/absent, ZERO_FLOOR for polish/shell. Derived, not hard-coded, so
// these meta-tests survive the repo map gaining/losing modules.
function expectedEntries(map: LooseMap): Record<string, typeof COVERAGE_FLOOR> {
  return Object.fromEntries(
    map.modules.map((m) => [
      `src/modules/${m.name as string}/**`,
      m.gates === 'polish' || m.gates === 'shell' ? ZERO_FLOOR : COVERAGE_FLOOR,
    ]),
  );
}

describe('gates helper (moduleCoverageThresholds)', () => {
  it('gives every module a glob entry: full/absent -> COVERAGE_FLOOR, polish/shell -> zero', () => {
    const tmp = mkdtempSync(join(ROOT, '.zz-module-coverage-'));
    try {
      const map: LooseMap = JSON.parse(JSON.stringify(REAL_MAP));
      map.modules.push(
        { name: 'zz_cov_full', gates: 'full' },
        { name: 'zz_cov_absent' },
        { name: 'zz_cov_polish', gates: 'polish' },
        { name: 'zz_cov_shell', gates: 'shell' },
      );
      const mapPath = join(tmp, 'module-map.json');
      writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');

      const result = moduleCoverageThresholds(mapPath);
      expect(result['src/modules/zz_cov_full/**']).toEqual(COVERAGE_FLOOR);
      expect(result['src/modules/zz_cov_absent/**']).toEqual(COVERAGE_FLOOR);
      expect(result['src/modules/zz_cov_polish/**']).toEqual(ZERO_FLOOR);
      expect(result['src/modules/zz_cov_shell/**']).toEqual(ZERO_FLOOR);
      expect(result).toEqual(expectedEntries(map));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('covers every module in the real repo map, one glob entry each, nothing extra', () => {
    const result = moduleCoverageThresholds(join(ROOT, 'module-map.json'));
    expect(result).toEqual(expectedEntries(REAL_MAP as LooseMap));
    expect(Object.keys(result)).toHaveLength((REAL_MAP as LooseMap).modules.length);
  });

  it('ignores a MODULE_MAP env override with no explicit path (config-eval-time safety)', () => {
    // gates.ts calls readModuleMap WITHOUT useEnv — a stray MODULE_MAP must
    // never swap the real coverage thresholds out from under vitest.config.ts.
    // Point MODULE_MAP at a nonexistent file: if moduleCoverageThresholds()
    // honored it, this would throw trying to read that path; since it
    // doesn't, calling with no argument still resolves the real repo map.
    const bogus = join(ROOT, '.zz-module-coverage-bogus-does-not-exist', 'module-map.json');
    const prev = process.env.MODULE_MAP;
    process.env.MODULE_MAP = bogus;
    try {
      expect(moduleCoverageThresholds()).toEqual(expectedEntries(REAL_MAP as LooseMap));
    } finally {
      if (prev === undefined) delete process.env.MODULE_MAP;
      else process.env.MODULE_MAP = prev;
    }
  });
});

// Heavier integration probe: spin up an isolated sandbox project (its own
// vitest config + a throwaway module) inside the repo tree (so bare-specifier
// resolution for 'vitest/config' etc. walks up to the real node_modules) and
// prove the PER-MODULE glob actually fails a real `vitest run --coverage`
// when a `full` module falls under floor. This spawns a real nested vitest
// process — expensive, and per vitest.framework.config.ts's own comments,
// deliberately outside `pnpm verify`; it runs only under `pnpm test:framework`.
describe('per-module floor enforcement (real vitest run)', () => {
  it('fails coverage when a full module is under COVERAGE_FLOOR', { timeout: 120_000 }, () => {
    const sandbox = mkdtempSync(join(ROOT, '.zz-coverage-sandbox-'));
    try {
      const moduleDir = join(sandbox, 'src/modules/zz_under');
      mkdirSync(join(moduleDir, '__tests__'), { recursive: true });
      // One function with an untested branch: line/branch coverage on
      // this file lands well under COVERAGE_FLOOR (e.g. 80%).
      writeFileSync(
        join(moduleDir, 'index.ts'),
        [
          'export function pick(hot: boolean): string {',
          '  if (hot) {',
          "    return 'hot';",
          '  }',
          "  return 'cold';",
          '}',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(moduleDir, '__tests__/index.test.ts'),
        [
          "import { describe, it, expect } from 'vitest';",
          "import { pick } from '../index.ts';",
          "describe('pick', () => {",
          "  it('covers only the hot branch', () => {",
          "    expect(pick(true)).toBe('hot');",
          '  });',
          '});',
          '',
        ].join('\n'),
      );

      const thresholds = { 'src/modules/zz_under/**': COVERAGE_FLOOR };
      writeFileSync(
        join(sandbox, 'vitest.config.ts'),
        [
          "import { defineConfig } from 'vitest/config';",
          'export default defineConfig({',
          '  test: {',
          "    include: ['src/modules/**/*.test.ts'],",
          '    coverage: {',
          "      provider: 'v8',",
          "      include: ['src/modules/**/*.ts'],",
          "      exclude: ['src/modules/**/__tests__/**'],",
          `      thresholds: ${JSON.stringify(thresholds)},`,
          '    },',
          '  },',
          '});',
          '',
        ].join('\n'),
      );

      const res = spawnSync(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          '--coverage',
          '--root',
          sandbox,
          '--config',
          join(sandbox, 'vitest.config.ts'),
        ],
        { cwd: ROOT, encoding: 'utf8' },
      );
      const out = (res.stdout ?? '') + (res.stderr ?? '');
      expect(res.status).not.toBe(0);
      expect(out).toContain('zz_under');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
