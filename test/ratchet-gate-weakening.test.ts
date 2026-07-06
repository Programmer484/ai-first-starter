// Probes for scripts/ratchet.ts's two checks: (1) the coverage floor now
// lives in scripts/gates.ts (COVERAGE_FLOOR), not vitest.config.ts; (2) no
// module's `gates` profile may weaken vs. the baseline ref.
//
// Env seams exercised here: RATCHET_BASE_CONTENT / RATCHET_BASE /
// RATCHET_REQUIRE are unchanged from before (still override the coverage
// baseline); RATCHET_MODULE_MAP_BASE_CONTENT is the new analogous override
// for module-map.json's baseline; MODULE_MAP is the existing module-map.ts
// seam (module-sync.ts, new-module.ts already honor it), reused here so
// ratchet's CURRENT-side map read can be pointed at a doctored file instead
// of the real module-map.json.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Derive the repo's current floor from scripts/gates.ts so these probes
// survive future ratcheting.
const gatesSrc = readFileSync(join(ROOT, 'scripts/gates.ts'), 'utf8');
const current = Number(/COVERAGE_FLOOR[\s\S]*?lines:\s*(\d+)/.exec(gatesSrc)![1]);

const REAL_MAP_TEXT = readFileSync(join(ROOT, 'module-map.json'), 'utf8');

const gatesFileWithFloor = (lines: number) =>
  `export const COVERAGE_FLOOR = { lines: ${lines}, functions: ${lines}, branches: ${lines}, statements: ${lines} };`;

function ratchet(env: Record<string, string>) {
  return run('node', ['scripts/ratchet.ts'], { env });
}

describe('rule 7: coverage floor lives in scripts/gates.ts', () => {
  it('fails when the floor is lowered, naming both numbers, the file, and rule 7', () => {
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: gatesFileWithFloor(current + 10),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(1);
    expect(out).toContain('lowered');
    expect(out).toContain(String(current + 10));
    expect(out).toContain(String(current));
    expect(out).toContain('scripts/gates.ts');
    expect(out).toContain('rule 7');
  });

  it('passes when the floor is unchanged', () => {
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: gatesFileWithFloor(current),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
    expect(out).toContain('coverage floor OK');
  });

  it('passes when the floor was raised', () => {
    const { status } = ratchet({
      RATCHET_BASE_CONTENT: gatesFileWithFloor(current - 10),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
  });

  it('fails when a non-lines floor is lowered, naming the key', () => {
    const withBranches = `export const COVERAGE_FLOOR = { lines: ${current}, branches: ${current + 10} };`;
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: withBranches,
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(1);
    expect(out).toContain('branches');
    expect(out).toContain(String(current + 10));
  });

  it('skips the floor comparison when the baseline copy of gates.ts has no COVERAGE_FLOOR anchor', () => {
    // Absent from baseline = nothing to guard (a pre-anchor baseline is not a
    // regression); only the CURRENT file is required to carry the anchor.
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: 'export const NOT_THE_FLOOR = 1;',
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
    expect(out).toContain('no COVERAGE_FLOOR anchor');
    expect(out).toContain('scripts/gates.ts');
  });

  it('skip-passes when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz' });
    expect(status).toBe(0);
    expect(out).toContain('no baseline ref, skipping');
  });

  it('fails under RATCHET_REQUIRE when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz', RATCHET_REQUIRE: '1' });
    expect(status).toBe(1);
    expect(out).toContain('git fetch origin main');
  });
});

describe('gate-profile weakening check', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ratchet-gate-weaken-'));
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // Build a full copy of the real map with `gates` overridden for named
  // modules (undefined = delete the key, i.e. "full"), plus optional extra
  // modules appended (for the "new module" case).
  function mapWith(
    overrides: Record<string, string | undefined>,
    extra: Array<{ name: string; gates?: string }> = [],
  ): string {
    const map = JSON.parse(REAL_MAP_TEXT) as { modules: Array<Record<string, unknown>> };
    for (const m of map.modules) {
      const name = m.name as string;
      if (name in overrides) {
        const g = overrides[name];
        if (g === undefined) delete m.gates;
        else m.gates = g;
      }
    }
    for (const e of extra) map.modules.push({ name: e.name, gates: e.gates });
    return JSON.stringify(map);
  }

  function ratchetWithMaps(opts: { current: string; baseline: string }): {
    status: number | null;
    out: string;
  } {
    // afterEach removes the whole tmp dir; recreate it so every test in this
    // describe gets a fresh, existing dir (mkdtempSync ran only once).
    mkdirSync(tmp, { recursive: true });
    const mapPath = join(tmp, `current-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(mapPath, opts.current);
    return ratchet({
      MODULE_MAP: mapPath,
      RATCHET_BASE_CONTENT: gatesFileWithFloor(current),
      RATCHET_MODULE_MAP_BASE_CONTENT: opts.baseline,
    });
  }

  it('fails when a module weakens full -> polish, naming both profiles and the module', () => {
    const { status, out } = ratchetWithMaps({
      current: mapWith({ _example: 'polish' }),
      baseline: mapWith({ _example: undefined }),
    });
    expect(status).toBe(1);
    expect(out).toContain('_example');
    expect(out).toContain('full -> polish');
  });

  it('fails when a module weakens full -> shell', () => {
    const { status, out } = ratchetWithMaps({
      current: mapWith({ _example: 'shell' }),
      baseline: mapWith({ _example: undefined }),
    });
    expect(status).toBe(1);
    expect(out).toContain('full -> shell');
  });

  it('fails when a module weakens polish -> shell', () => {
    const { status, out } = ratchetWithMaps({
      current: mapWith({ _example: 'shell' }),
      baseline: mapWith({ _example: 'polish' }),
    });
    expect(status).toBe(1);
    expect(out).toContain('polish -> shell');
  });

  it('passes when a module strengthens shell -> full', () => {
    const { status } = ratchetWithMaps({
      current: mapWith({ _example: undefined }),
      baseline: mapWith({ _example: 'shell' }),
    });
    expect(status).toBe(0);
  });

  it('passes when a module strengthens shell -> polish', () => {
    const { status } = ratchetWithMaps({
      current: mapWith({ _example: 'polish' }),
      baseline: mapWith({ _example: 'shell' }),
    });
    expect(status).toBe(0);
  });

  it('passes for a new module absent from the baseline, at any profile', () => {
    const { status } = ratchetWithMaps({
      current: mapWith({}, [{ name: 'zz_new_shell', gates: 'shell' }]),
      baseline: mapWith({}),
    });
    expect(status).toBe(0);
  });

  it('passes when no module weakened', () => {
    const { status, out } = ratchetWithMaps({
      current: mapWith({}),
      baseline: mapWith({}),
    });
    expect(status).toBe(0);
    expect(out).toContain('gate-profile OK');
  });
});
