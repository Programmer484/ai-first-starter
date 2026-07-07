// Probes for the coverage-floor ratchet (CLAUDE.md rule 7). Each test spawns
// `node scripts/ratchet.ts` directly with env overrides — no shared repo
// state is touched, so these are safe under parallel workers.
// The floor anchor lives in scripts/gates.ts (COVERAGE_FLOOR), not
// vitest.config.ts: RATCHET_BASE_CONTENT overrides the baseline copy of
// gates.ts, RATCHET_MODULE_MAP_BASE_CONTENT the baseline module-map.json
// (pinned to the real map here so only the floor check is exercised).
import { describe, it, expect } from 'vitest';
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

function ratchet(env: Record<string, string>) {
  return run('node', ['scripts/ratchet.ts'], { env });
}

const base = (lines: number) =>
  `export const COVERAGE_FLOOR = { lines: ${lines}, functions: ${lines}, branches: ${lines}, statements: ${lines} };`;

describe('rule 7: coverage floor only ratchets upward', () => {
  it('fails when the floor is lowered, naming both numbers and the rule', () => {
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: base(current + 10),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(1);
    expect(out).toContain('lowered');
    expect(out).toContain(String(current + 10));
    expect(out).toContain(String(current));
    expect(out).toContain('rule 7');
  });

  it('passes when the floor is unchanged', () => {
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: base(current),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
    expect(out).toContain('coverage floor OK');
  });

  it('passes when the floor was raised', () => {
    const { status } = ratchet({
      RATCHET_BASE_CONTENT: base(current - 10),
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
  });

  it('fails when a non-lines floor is lowered or removed, naming the key', () => {
    const withBranches = `export const COVERAGE_FLOOR = { lines: ${current}, branches: ${current + 10} };`;
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: withBranches,
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(1);
    expect(out).toContain('branches');
    expect(out).toContain(String(current + 10));
  });

  it('fails under RATCHET_REQUIRE when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz', RATCHET_REQUIRE: '1' });
    expect(status).toBe(1);
    expect(out).toContain('git fetch origin main');
  });

  it('skip-passes when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz' });
    expect(status).toBe(0);
    expect(out).toContain('no baseline ref, skipping');
  });

  it('skips the floor comparison when the baseline has no COVERAGE_FLOOR anchor', () => {
    // A pre-anchor baseline (gates.ts from before the floor moved here out of
    // vitest.config.ts) has nothing to guard — same posture as a per-key
    // missing floor. Skip with a log line, don't fail.
    const { status, out } = ratchet({
      RATCHET_BASE_CONTENT: 'export default {};',
      RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
    });
    expect(status).toBe(0);
    expect(out).toContain('no COVERAGE_FLOOR anchor');
    expect(out).toContain('skipping');
  });

  it('hard-fails when the CURRENT gates.ts has no COVERAGE_FLOOR anchor', () => {
    // The skip above is baseline-only: the working tree must always carry the
    // anchor — a missing floor is a broken gate. Point the script at a
    // sandbox cwd whose scripts/gates.ts lacks the block.
    const tmp = mkdtempSync(join(tmpdir(), 'ratchet-no-anchor-'));
    try {
      mkdirSync(join(tmp, 'scripts'), { recursive: true });
      writeFileSync(join(tmp, 'scripts/gates.ts'), 'export const NOT_THE_FLOOR = 1;\n');
      const { status, out } = run('node', [join(ROOT, 'scripts/ratchet.ts')], {
        cwd: tmp,
        env: {
          RATCHET_BASE_CONTENT: base(current),
          RATCHET_MODULE_MAP_BASE_CONTENT: REAL_MAP_TEXT,
        },
      });
      expect(status).toBe(1);
      expect(out).toContain('COVERAGE_FLOOR');
      expect(out).toContain('scripts/gates.ts');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
