// Regression probes for the scope-guard Bash write-detection rewrite
// (root-caused false positives in hasWriteIndicator/bashOffendingPath):
//   1. A redirect target only counts as a write if it resolves INSIDE the
//      repo — 2>/dev/null and other out-of-repo targets are exempt, not just
//      targets starting with `&`.
//   2. Only actual write operands are scanned (redirect targets + arguments
//      of write verbs) instead of every path-shaped token once any indicator
//      fires — read-only commands (wc, diff, ls, find, grep, xargs, cat...)
//      are unblockable by construction.
//   3. A leading ~ or ~/ is expanded to the home dir before resolving, so it
//      can't be misread as a repo-relative path.
//   4. A scope recorded for a different branch (the `branch` field in
//      allowed-files.json) is treated as inactive, falling through to the
//      unscoped-nudge path with a one-line note.
// Same subprocess-probe pattern as scope-guard-hardening.test.ts: spawn the
// hook with a JSON payload on stdin, cwd pointed at a scratch temp dir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './helpers.ts';

let cwd: string;
let taskFile: string;
let logFile: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'scope-guard-write-probe-'));
  mkdirSync(join(cwd, '.task'), { recursive: true });
  taskFile = join(cwd, '.task/allowed-files.json');
  logFile = join(cwd, 'edit-log.jsonl');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runHook(payload: object) {
  return run('node', ['.claude/hooks/scope-guard.ts'], { input: JSON.stringify(payload) });
}

function setScope(allow: string[], branch?: string) {
  writeFileSync(taskFile, JSON.stringify({ allow, ...(branch ? { branch } : {}) }, null, 2) + '\n');
}

describe('read-only commands are unblockable by construction', () => {
  it('allows find | sort | xargs wc -l alongside an exempt 2>/dev/null redirect', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command:
          `find ${cwd}/src/modules/assets -type f -name "*.ts" | sort | xargs wc -l; ` +
          `ls ${cwd}/coverage/ 2>/dev/null`,
      },
      cwd,
    });
    expect(status).toBe(0);
  });

  it('allows wc -l on an out-of-scope path with a trailing 2>/dev/null', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: `wc -l ${cwd}/src/modules/assets/*.ts 2>/dev/null` },
      cwd,
    });
    expect(status).toBe(0);
  });

  it('allows a ~-expanded ls with a trailing 2>/dev/null', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'ls -d ~/Documents/*/ 2>/dev/null' },
      cwd,
    });
    expect(status).toBe(0);
  });

  it('allows a cd + git log + diff + head chain with a trailing 2>/dev/null', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: {
        command:
          `cd /elsewhere && git log --oneline -5 && ` +
          `diff -rq scripts ${cwd}/scripts 2>/dev/null | head -20`,
      },
      cwd,
    });
    expect(status).toBe(0);
  });
});

describe('a ~-prefixed write target resolves to the home dir, not a repo path', () => {
  it('allows touch ~/... even though it looks path-shaped and un-globbed', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'touch ~/scope-guard-tilde-probe-does-not-exist.txt' },
      cwd,
    });
    expect(status).toBe(0);
  });
});

describe('write operands are still caught (no regression from the narrower scan)', () => {
  it('blocks a redirect writing an out-of-scope file', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo x > src/out-of-scope.ts' },
      cwd,
    });
    expect(status).toBe(2);
  });

  it('blocks sed -i on an out-of-scope file', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: "sed -i 's/a/b/' src/out-of-scope.ts" },
      cwd,
    });
    expect(status).toBe(2);
  });

  it('blocks mv into an out-of-scope destination', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'mv a.ts src/out-of-scope.ts' },
      cwd,
    });
    expect(status).toBe(2);
  });

  it('blocks a bash write to .task/allowed-files.json', () => {
    setScope(['src/modules/other/**']);
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo "{}" > .task/allowed-files.json' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain("don't hand-edit .task/allowed-files.json");
  });

  it('blocks a redirect to the scope file even with a control operator glued on (no ;true bypass)', () => {
    setScope(['src/modules/other/**']);
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo x >.task/allowed-files.json;true' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain("don't hand-edit .task/allowed-files.json");
  });

  it('does not misread a glued && chain as part of the redirect target (no false block)', () => {
    setScope(['src/foo.ts']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo x > src/foo.ts&&pnpm verify' },
      cwd,
    });
    expect(status).toBe(0); // target is src/foo.ts (in scope), not "src/foo.ts&&pnpm"
  });

  it('blocks truncating the edit-log.jsonl ledger', () => {
    setScope(['src/modules/other/**']);
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: '> edit-log.jsonl' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain('append-only');
  });
});

describe('protected files stay bash-blocked without an active scope', () => {
  it('blocks a bash write to .task/allowed-files.json when no scope is active', () => {
    // No setScope: the always-block must not vanish with the scope.
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo "{}" > .task/allowed-files.json' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain("don't hand-edit .task/allowed-files.json");
  });

  it('blocks truncating edit-log.jsonl when no scope is active', () => {
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: '> edit-log.jsonl' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain('append-only');
  });

  it('blocks a bash write to the scope file when the scope is drift-deactivated', () => {
    execFileSync('git', ['init', '-q', '-b', 'probe-branch'], { cwd });
    execFileSync('git', ['config', 'user.email', 'probe@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'probe'], { cwd });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
    setScope(['src/modules/other/**'], 'other-branch'); // drifted: HEAD is probe-branch

    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo "{}" > .task/allowed-files.json' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain("don't hand-edit .task/allowed-files.json");
  });

  it('blocks an Edit-tool write to .task/allowed-files.json when no scope is active', () => {
    const { status, out } = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, '.task/allowed-files.json') },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain("don't hand-edit .task/allowed-files.json");
  });

  it('still allows other bash writes with no scope active', () => {
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo x > src/anything.ts' },
      cwd,
    });
    expect(status).toBe(0);
  });
});

describe('branch drift: a scope recorded for another branch is treated as inactive', () => {
  it('falls through to the unscoped nudge (not a scope-block) when HEAD differs from the recorded branch', () => {
    execFileSync('git', ['init', '-q', '-b', 'probe-branch'], { cwd });
    execFileSync('git', ['config', 'user.email', 'probe@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'probe'], { cwd });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
    setScope(['src/modules/other/**'], 'other-branch'); // current branch is "probe-branch"

    const payload = {
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/modules/_example/index.ts') },
      cwd,
    };
    const first = runHook(payload);
    expect(first.status).toBe(2); // unscoped nudge fires once, same as no scope at all
    expect(first.out).toContain('treating the scope as inactive');
    expect(first.out).toContain('pnpm scope');
    expect(existsSync(logFile)).toBe(false); // not a scope-block — never logged as one

    const second = runHook(payload);
    expect(second.status).toBe(0); // nudge is one-time; scope was never enforced
  });

  it('does not affect a scope whose recorded branch matches HEAD', () => {
    execFileSync('git', ['init', '-q', '-b', 'probe-branch'], { cwd });
    execFileSync('git', ['config', 'user.email', 'probe@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'probe'], { cwd });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
    setScope(['src/modules/other/**'], 'probe-branch'); // matches current branch

    const { status, out } = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/modules/_example/index.ts') },
      cwd,
    });
    expect(status).toBe(2); // enforced normally: out of scope
    expect(out).not.toContain('treating the scope as inactive');
    expect(out).toContain('pnpm scope --add');
  });
});
