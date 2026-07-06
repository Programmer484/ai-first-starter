// Probes for the lefthook pre-push guard (scripts/pre-push-guard.ts): pushing
// from the default branch is refused with a `pnpm pr` pointer, ALLOW_MAIN_PUSH=1
// lets it through and appends an override record to the edit log, and feature
// branches pass untouched. Each probe runs the real script inside a sandboxed
// git repo, with EDIT_LOG redirected into the sandbox so the live ledger is
// never written.
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/pre-push-guard.ts');

let repo: string;
let logPath: string;

// Fresh sandbox repo per probe: init, one commit so branches exist.
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pre-push-guard-'));
  logPath = join(repo, 'edit-log.jsonl');
  const g = (args: string[]) => run('git', args, { cwd: repo });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'probe@test']);
  g(['config', 'user.name', 'probe']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function runGuard(env: Record<string, string> = {}): { status: number | null; out: string } {
  return run('node', [GUARD], { cwd: repo, env: { EDIT_LOG: logPath, ...env } });
}

describe('pre-push-guard', () => {
  it('refuses a push from the default branch and points at pnpm pr', () => {
    const res = runGuard();
    expect(res.status).toBe(1);
    expect(res.out).toContain('Refusing to push the default branch');
    expect(res.out).toContain('pnpm pr');
    expect(existsSync(logPath)).toBe(false); // no override record on a plain block
  });

  it('ALLOW_MAIN_PUSH=1 lets the push through and logs the override', () => {
    const res = runGuard({ ALLOW_MAIN_PUSH: '1' });
    expect(res.status).toBe(0);
    expect(res.out).toContain('override logged');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(record.kind).toBe('main-push-override');
    expect(record.branch).toBe('main');
  });

  it('passes silently on a feature branch', () => {
    run('git', ['checkout', '-q', '-b', 'feature/thing'], { cwd: repo });
    const res = runGuard();
    expect(res.status).toBe(0);
    expect(res.out.trim()).toBe('');
  });

  it('reads the default branch from origin/HEAD, not a hardcoded main', () => {
    // Default branch is 'trunk' via the origin/HEAD symbolic ref: 'main'
    // must now pass and 'trunk' must be blocked.
    run('git', ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'], { cwd: repo });
    run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], {
      cwd: repo,
    });
    expect(runGuard().status).toBe(0); // on main, default is trunk

    run('git', ['checkout', '-q', '-b', 'trunk'], { cwd: repo });
    const res = runGuard();
    expect(res.status).toBe(1);
    expect(res.out).toContain("'trunk'");
  });
});
