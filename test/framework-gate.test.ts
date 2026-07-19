// Pins the framework-change gate: the shared path matcher's CLI predicate,
// the lefthook `3_framework` pre-commit wiring, and — most importantly — the
// coordinated pair: FRAMEWORK_PATH_RE (scripts/framework-paths.ts) must be
// byte-for-byte IDENTICAL to the grep pattern in ci.yml's "Detect framework
// changes" step, or a path gated locally would silently skip CI (or vice
// versa).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMEWORK_PATH_RE } from '../scripts/framework-paths.ts';

const repoRoot = join(import.meta.dirname, '..');

function runCli(stdin: string): number | null {
  const res = spawnSync('node', ['scripts/framework-paths.ts'], {
    cwd: repoRoot,
    input: stdin,
    encoding: 'utf8',
  });
  return res.status;
}

describe('framework-paths CLI predicate', () => {
  it('exits 0 when at least one stdin line is a framework path', () => {
    expect(runCli('src/modules/pricing/index.ts\nscripts/verify.ts\n')).toBe(0);
  });

  it('exits 1 when no stdin line is a framework path', () => {
    expect(runCli('src/modules/pricing/index.ts\nREADME.md\n')).toBe(1);
  });

  it('exits 1 on empty input', () => {
    expect(runCli('')).toBe(1);
  });
});

describe('lefthook 3_framework pre-commit gate', () => {
  const lefthook = readFileSync(join(repoRoot, 'lefthook.yml'), 'utf8');

  it('pre-commit has a 3_framework command wired to the predicate and the suite', () => {
    expect(lefthook).toContain('3_framework:');
    expect(lefthook).toContain('git diff --cached --name-only | node scripts/framework-paths.ts');
    expect(lefthook).toContain('pnpm test:framework');
  });
});

describe('FRAMEWORK_PATH_RE ↔ ci.yml coordinated pair', () => {
  it('is IDENTICAL to the grep pattern in ci.yml\'s "Detect framework changes" step', () => {
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const afterMarker = ci.slice(ci.indexOf('Detect framework changes'));
    const grep = /grep -qE '([^']+)'/.exec(afterMarker);
    expect(grep).not.toBeNull();
    // RegExp.source always escapes `/` as `\/` (spec-mandated, so the source
    // round-trips as a literal); grep's pattern has no such requirement.
    // Unescape that one construct — everything else must match byte-for-byte.
    expect(FRAMEWORK_PATH_RE.source.replace(/\\\//g, '/')).toBe(grep![1]);
  });
});
