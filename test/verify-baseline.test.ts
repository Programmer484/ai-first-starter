// Probes for `pnpm verify --baseline`: an untracked unformatted file fails
// format in the working tree but cannot exist in the HEAD worktree, so the
// baseline must classify it as introduced. Uses zz_baseline_* probe names to
// stay clear of sibling test files' probes.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLine } from '../scripts/baseline.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(ROOT, 'src/modules/zz_baseline_probe');

function run(args: string[]) {
  const res = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

function plantProbe() {
  mkdirSync(PROBE, { recursive: true });
  writeFileSync(join(PROBE, 'index.ts'), 'export const x =    1\n');
}

afterEach(() => {
  rmSync(PROBE, { recursive: true, force: true });
});

describe('verify --baseline', () => {
  it(
    'classifies an untracked format failure as introduced and leaves no worktree behind',
    { timeout: 180_000 },
    () => {
      // Delta-based leftover check: `git worktree list` is repo-global, so a
      // concurrent session running this same suite may legitimately hold its
      // own verify-baseline-* worktree. Only NEW entries are ours.
      const listWorktrees = () =>
        spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' })
          .stdout.split('\n')
          .filter((l) => l.includes('verify-baseline-'));
      const before = new Set(listWorktrees());

      plantProbe();
      try {
        const { status, out } = run(['scripts/verify.ts', 'format', '--baseline']);
        expect(status).not.toBe(0);
        expect(out).toContain('introduced by working-tree changes');

        expect(listWorktrees().filter((l) => !before.has(l))).toEqual([]);
      } finally {
        rmSync(PROBE, { recursive: true, force: true });
      }
    },
  );
});

describe('the --baseline hint line', () => {
  it('a failing verify without the flag prints the hint', { timeout: 60_000 }, () => {
    plantProbe();
    try {
      const { status, out } = run(['scripts/verify.ts', 'format']);
      expect(status).not.toBe(0);
      expect(out).toContain('pnpm verify --baseline');
    } finally {
      rmSync(PROBE, { recursive: true, force: true });
    }
  });

  it('a passing verify prints no hint', { timeout: 60_000 }, () => {
    // ratchet, not format: `prettier --check .` sees sibling suites'
    // transient zz_* probe files under parallel workers; ratchet only reads
    // vitest.config.ts + git refs, so it passes regardless of sibling state.
    const { status, out } = run(['scripts/verify.ts', 'ratchet']);
    expect(status).toBe(0);
    expect(out).not.toContain('pnpm verify --baseline');
  });
});

describe('classifyLine', () => {
  it('a step that also fails at HEAD is pre-existing', () => {
    expect(classifyLine('lint', false)).toBe('baseline: lint — pre-existing (also fails at HEAD)');
  });

  it('a step that passes at HEAD was introduced', () => {
    expect(classifyLine('lint', true)).toBe(
      'baseline: lint — introduced by working-tree changes (passes at HEAD)',
    );
  });
});
