// Probes for `pnpm pr` (scripts/pr.ts). The pure helpers (extractPreviewUrl,
// chooseBranch, checkShipBranch, frameworkFiles, frameworkTail) are probed
// directly without `gh` or git; the stateful branch logic in main() is probed
// at the bottom by running the real script inside a sandboxed git repo.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractPreviewUrl,
  chooseBranch,
  checkShipBranch,
  frameworkFiles,
  frameworkTail,
} from '../scripts/pr.ts';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('extractPreviewUrl', () => {
  it('finds a preview URL in a check targetUrl', () => {
    const json = JSON.stringify({
      statusCheckRollup: [
        { name: 'lint', targetUrl: 'https://ci.example.com/build/1' },
        { name: 'Vercel', targetUrl: 'https://my-app-git-feat-foo.vercel.app' },
      ],
      comments: [],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app-git-feat-foo.vercel.app');
  });

  it('finds a preview URL in a check detailsUrl', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'Vercel', detailsUrl: 'https://my-app.vercel.app/details' }],
      comments: [],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app.vercel.app/details');
  });

  it('finds a preview URL in a vercel[bot] comment when checks have none', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'lint', targetUrl: 'https://ci.example.com/build/2' }],
      comments: [
        { author: { login: 'someone' }, body: 'looks good' },
        {
          author: { login: 'vercel[bot]' },
          body: 'This preview is ready! https://my-app-git-abc123.vercel.app inspect it here.',
        },
      ],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app-git-abc123.vercel.app');
  });

  it('returns null when no vercel.app URL appears anywhere', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'lint', targetUrl: 'https://ci.example.com/build/3' }],
      comments: [{ author: { login: 'someone' }, body: 'looks good, ship it' }],
    });
    expect(extractPreviewUrl(json)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractPreviewUrl('not json')).toBeNull();
  });

  it('returns null for valid JSON that is not an object', () => {
    expect(extractPreviewUrl('null')).toBeNull();
    expect(extractPreviewUrl('42')).toBeNull();
  });
});

// Branch selection for `pnpm pr` when run from the default branch (see
// chooseBranch in scripts/pr.ts). Pins the stale-state fix: `.task/branch`
// is honored only when it matches the scope file's `branch` AND the branch
// doesn't already exist in git.
describe('chooseBranch', () => {
  const base = {
    branchFlag: undefined,
    title: 'fix: tidy the docs',
    taskBranch: '',
    scopeBranch: '',
    branchExists: false,
  };

  it('--branch flag wins over everything', () => {
    expect(
      chooseBranch({
        ...base,
        branchFlag: 'feat/explicit',
        taskBranch: 'feature/from-scope',
        scopeBranch: 'feature/from-scope',
      }),
    ).toBe('feat/explicit');
  });

  it('honors a fresh scope branch (matches scope file, not yet in git)', () => {
    expect(
      chooseBranch({ ...base, taskBranch: 'feature/topic', scopeBranch: 'feature/topic' }),
    ).toBe('feature/topic');
  });

  it('ignores a stale .task/branch whose branch already exists in git', () => {
    expect(
      chooseBranch({
        ...base,
        taskBranch: 'feature/claude-md',
        scopeBranch: 'feature/claude-md',
        branchExists: true,
      }),
    ).toBe('feat/fix-tidy-the-docs');
  });

  it('ignores .task/branch that disagrees with the scope file', () => {
    expect(
      chooseBranch({ ...base, taskBranch: 'feature/orphan', scopeBranch: 'feature/other' }),
    ).toBe('feat/fix-tidy-the-docs');
  });

  it('ignores .task/branch when no scope file corroborates it', () => {
    expect(chooseBranch({ ...base, taskBranch: 'feature/usr-bin-env-node' })).toBe(
      'feat/fix-tidy-the-docs',
    );
  });

  it('slugs the title when no branch state exists: lowercased, dashed, capped at 40', () => {
    expect(
      chooseBranch({ ...base, title: 'Feat: A Very Long Title That Keeps Going On And On!' }),
    ).toBe('feat/' + 'feat-a-very-long-title-that-keeps-going-on-and-on'.slice(0, 40));
  });
});

// Guard for `pnpm pr` run from a NON-default branch (see checkShipBranch in
// scripts/pr.ts). Pins the concurrent-session collision fix: with a shared
// working tree, the checked-out branch may belong to another task — shipping
// there fast-forwarded one session's commit into another session's open PR
// (DEBT-5). A scope recorded for a different branch must refuse the ship
// unless --branch explicitly names the checked-out branch.
describe('checkShipBranch', () => {
  it('allows when no scope branch is recorded (no corroboration either way)', () => {
    expect(
      checkShipBranch({ current: 'feat/anything', scopeBranch: '', branchFlag: undefined }),
    ).toEqual({ ok: true, overridden: false });
  });

  it('allows when the scope branch matches the checked-out branch', () => {
    expect(
      checkShipBranch({
        current: 'feature/topic',
        scopeBranch: 'feature/topic',
        branchFlag: undefined,
      }),
    ).toEqual({ ok: true, overridden: false });
  });

  it("refuses when the scope was recorded for another task's branch", () => {
    const res = checkShipBranch({
      current: 'feature/other-sessions-task',
      scopeBranch: 'feature/mine',
      branchFlag: undefined,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('feature/mine');
      expect(res.reason).toContain('feature/other-sessions-task');
    }
  });

  it('allows a mismatch when --branch explicitly names the checked-out branch, flagged for logging', () => {
    expect(
      checkShipBranch({
        current: 'feature/other-sessions-task',
        scopeBranch: 'feature/mine',
        branchFlag: 'feature/other-sessions-task',
      }),
    ).toEqual({ ok: true, overridden: true });
  });

  it('still refuses when --branch names some third branch', () => {
    const res = checkShipBranch({
      current: 'feature/other-sessions-task',
      scopeBranch: 'feature/mine',
      branchFlag: 'feat/third',
    });
    expect(res.ok).toBe(false);
  });
});

// Framework-gate helpers in `pnpm pr` (see frameworkFiles/frameworkTail in
// scripts/pr.ts): pure functions over a changed-file list and a
// test:framework output, so these run without git or vitest spawns.
describe('frameworkFiles', () => {
  it('keeps only framework-owned paths from a mixed change list', () => {
    expect(
      frameworkFiles([
        'src/modules/pricing/index.ts',
        'scripts/pr.ts',
        'README.md',
        'test/framework-gate.test.ts',
        'lefthook.yml',
      ]),
    ).toEqual(['scripts/pr.ts', 'test/framework-gate.test.ts', 'lefthook.yml']);
  });

  it('returns an empty list for an app-only diff', () => {
    expect(frameworkFiles(['src/modules/pricing/index.ts', 'DEBT.md', 'docs/notes.md'])).toEqual(
      [],
    );
  });

  it('does not match framework-like names outside the repo-root anchors', () => {
    expect(frameworkFiles(['src/scripts/helper.ts', 'app/lefthook.yml.bak'])).toEqual([]);
  });
});

describe('frameworkTail', () => {
  it('returns everything from the " Test Files " summary line onward', () => {
    const output = [
      '✓ test/a.test.ts (3 tests)',
      '✓ test/b.test.ts (5 tests)',
      ' Test Files  19 passed (19)',
      '      Tests  120 passed (120)',
      '   Duration  85.2s',
    ].join('\n');
    expect(frameworkTail(output)).toBe(
      [' Test Files  19 passed (19)', '      Tests  120 passed (120)', '   Duration  85.2s'].join(
        '\n',
      ),
    );
  });

  it('falls back to the last 10 lines when no summary marker exists', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    expect(frameworkTail(lines.join('\n'))).toBe(lines.slice(-10).join('\n'));
  });

  it('ignores trailing blank lines when taking the fallback tail', () => {
    expect(frameworkTail('a\nb\n\n\n')).toBe('a\nb');
  });

  it('strips ANSI color codes so the PR body stays readable', () => {
    const output = [
      '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m21 passed\u001b[39m\u001b[22m',
      '\u001b[2m   Duration \u001b[22m 42.9s',
    ].join('\n');
    expect(frameworkTail(output)).toBe(' Test Files  21 passed\n   Duration  42.9s');
  });
});

// Sandboxed probes for the STATEFUL branch logic in scripts/pr.ts's main():
// scope-file parse, git probes (including the ls-remote stale-branch check),
// consume-once deletion of .task/branch, and the checkShipBranch wiring.
// Each probe runs the real script inside a throwaway git repo wired to a
// local bare "origin", with `gh` stubbed on PATH (no network) and EDIT_LOG
// redirected so the live ledger is never written (same isolation as the
// pre-push-guard probes). Pins DEBT-4 (a/b/c) and DEBT-5.
describe('pr.ts ship-branch integration', () => {
  const PR_SCRIPT = join(ROOT, 'scripts/pr.ts');
  let base: string;
  let repo: string;
  let bare: string;
  let logPath: string;
  let env: Record<string, string>;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'pr-ship-'));
    repo = join(base, 'work');
    bare = join(base, 'origin.git');
    logPath = join(base, 'edit-log.jsonl');
    mkdirSync(repo);
    const g = (args: string[]) => run('git', args, { cwd: repo });
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 'probe@test']);
    g(['config', 'user.name', 'probe']);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    g(['add', '.']);
    g(['commit', '-q', '-m', 'init']);
    run('git', ['init', '-q', '--bare', bare]);
    g(['remote', 'add', 'origin', bare]);
    g(['push', '-q', '-u', 'origin', 'main']);
    // Stub `gh` ahead of the real one on PATH: `pr create` prints a fake PR
    // URL (pr.ts logs it), every other subcommand succeeds silently.
    const bin = join(base, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      '#!/bin/sh\nif [ "$1 $2" = "pr create" ]; then echo "https://github.com/example/e/pull/1"; fi\nexit 0\n',
    );
    chmodSync(join(bin, 'gh'), 0o755);
    env = {
      PATH: bin + ':' + (process.env.PATH ?? ''),
      EDIT_LOG: logPath,
      PR_PREVIEW_ATTEMPTS: '1',
      PR_PREVIEW_DELAY_MS: '0',
    };
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  // Run the real pr.ts in the sandbox with something to commit. --no-verify
  // keeps the probe on the branch logic (verify and test:framework do not
  // exist inside the sandbox); its skip record lands in the redirected log.
  function ship(args: string[] = []): { status: number | null; out: string } {
    writeFileSync(join(repo, 'change.txt'), 'change\n');
    return run('node', [PR_SCRIPT, 'feat: probe ship', '--no-verify', ...args], {
      cwd: repo,
      env,
    });
  }

  function currentBranch(): string {
    return run('git', ['branch', '--show-current'], { cwd: repo }).out.trim();
  }

  it('uses a fresh .task/branch from the default branch, ships, and consumes it', () => {
    mkdirSync(join(repo, '.task'));
    writeFileSync(join(repo, '.task/branch'), 'feature/topic\n');
    writeFileSync(
      join(repo, '.task/allowed-files.json'),
      JSON.stringify({ branch: 'feature/topic' }),
    );
    const res = ship();
    expect(res.status).toBe(0);
    expect(currentBranch()).toBe('feature/topic');
    expect(existsSync(join(repo, '.task/branch'))).toBe(false); // consumed
    const pushed = run('git', ['rev-parse', '--verify', 'refs/heads/feature/topic'], {
      cwd: bare,
    });
    expect(pushed.status).toBe(0); // landed on origin
  });

  it('ignores a stale branch that exists only on the unfetched remote (DEBT-4a)', () => {
    // Created directly in the bare origin and never fetched: no local head,
    // no remote-tracking ref — only ls-remote can see it. Without the probe
    // the ship would reuse it and fast-forward-push onto the old branch.
    run('git', ['branch', 'feature/stale', 'main'], { cwd: bare });
    mkdirSync(join(repo, '.task'));
    writeFileSync(join(repo, '.task/branch'), 'feature/stale\n');
    writeFileSync(
      join(repo, '.task/allowed-files.json'),
      JSON.stringify({ branch: 'feature/stale' }),
    );
    const res = ship();
    expect(res.status).toBe(0);
    expect(currentBranch()).toBe('feat/feat-probe-ship'); // slug fallback, not the stale name
  });

  it('consumes .task/branch on the --branch path too (DEBT-4b)', () => {
    mkdirSync(join(repo, '.task'));
    writeFileSync(join(repo, '.task/branch'), 'feature/leftover\n');
    const res = ship(['--branch', 'feat/explicit']);
    expect(res.status).toBe(0);
    expect(currentBranch()).toBe('feat/explicit');
    expect(existsSync(join(repo, '.task/branch'))).toBe(false);
  });

  it("refuses to ship from another task's checked-out branch (DEBT-5)", () => {
    run('git', ['switch', '-q', '-c', 'feature/other-sessions-task'], { cwd: repo });
    mkdirSync(join(repo, '.task'));
    writeFileSync(
      join(repo, '.task/allowed-files.json'),
      JSON.stringify({ branch: 'feature/mine' }),
    );
    const res = ship();
    expect(res.status).toBe(1);
    expect(res.out).toContain('feature/mine');
    expect(res.out).toContain('feature/other-sessions-task');
    const commits = run('git', ['rev-list', '--count', 'HEAD'], { cwd: repo });
    expect(commits.out.trim()).toBe('1'); // nothing was committed
  });

  it('--branch naming the checked-out branch overrides the refusal and logs it', () => {
    run('git', ['switch', '-q', '-c', 'feature/other-sessions-task'], { cwd: repo });
    mkdirSync(join(repo, '.task'));
    writeFileSync(
      join(repo, '.task/allowed-files.json'),
      JSON.stringify({ branch: 'feature/mine' }),
    );
    const res = ship(['--branch', 'feature/other-sessions-task']);
    expect(res.status).toBe(0);
    const records = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.some((r) => r.kind === 'pr-branch-override')).toBe(true);
    const pushed = run('git', ['rev-parse', '--verify', 'refs/heads/feature/other-sessions-task'], {
      cwd: bare,
    });
    expect(pushed.status).toBe(0);
  });
});
