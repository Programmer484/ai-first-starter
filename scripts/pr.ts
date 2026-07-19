#!/usr/bin/env node
// Ship a task: create a branch (if on the default branch), commit, push, open a
// draft PR with `gh`, and drop a preview-link comment. Runs verify first — a
// red tree never becomes a PR.
//
// Usage: pnpm pr "feat: add foo module" [--branch feat/foo] [--body-file path] [--no-verify]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appendRun } from './edit-log.ts';
import { FRAMEWORK_PATH_RE } from './framework-paths.ts';

function run(cmd: string, args: string[], allowFail = false): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.status !== 0 && !allowFail) {
    console.error(res.stderr || res.stdout);
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
  return (res.stdout ?? '').trim();
}

// Extracts a Vercel preview URL (https://*.vercel.app) from `gh pr view
// --json statusCheckRollup,comments` output. Checked first against each
// check's targetUrl/detailsUrl, then against any comment body (vercel[bot]
// posts the preview link as a PR comment). Returns null if nothing matches.
// Pure + exported so it's testable without a real `gh` invocation.
export function extractPreviewUrl(jsonText: string): string | null {
  const urlPattern = /https:\/\/[a-zA-Z0-9.-]*\.vercel\.app[^\s"'<>)]*/;
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  const checks = obj.statusCheckRollup;
  if (Array.isArray(checks)) {
    for (const check of checks) {
      if (!check || typeof check !== 'object') continue;
      const c = check as Record<string, unknown>;
      for (const key of ['targetUrl', 'detailsUrl']) {
        const val = c[key];
        if (typeof val === 'string') {
          const m = urlPattern.exec(val);
          if (m) return m[0];
        }
      }
    }
  }

  const comments = obj.comments;
  if (Array.isArray(comments)) {
    for (const comment of comments) {
      if (!comment || typeof comment !== 'object') continue;
      const c = comment as Record<string, unknown>;
      const body = c.body;
      if (typeof body === 'string') {
        const m = urlPattern.exec(body);
        if (m) return m[0];
      }
    }
  }

  return null;
}

// Polls `gh pr view <branch> --json statusCheckRollup,comments` for a Vercel
// preview URL. Bounded by PR_PREVIEW_ATTEMPTS × PR_PREVIEW_DELAY_MS (env
// overrides let tests skip the wait entirely). Never throws — Vercel not
// being configured on a repo must not fail the script.
function pollForPreviewUrl(branch: string): string | null {
  const attempts = Number(process.env.PR_PREVIEW_ATTEMPTS ?? 12);
  const delayMs = Number(process.env.PR_PREVIEW_DELAY_MS ?? 10_000);
  for (let i = 0; i < attempts; i++) {
    const res = spawnSync('gh', ['pr', 'view', branch, '--json', 'statusCheckRollup,comments'], {
      encoding: 'utf8',
    });
    if (res.status === 0 && res.stdout) {
      const url = extractPreviewUrl(res.stdout);
      if (url) return url;
    }
    if (i < attempts - 1 && delayMs > 0) {
      spawnSync('sleep', [String(delayMs / 1000)]);
    }
  }
  return null;
}

// Guards the ship-on-current-branch path (`pnpm pr` run from a non-default
// branch). With one working tree (and one `.task/`) shared between concurrent
// sessions, "not on the default branch" does NOT imply "on this task's
// branch": session B's `pnpm pr` once committed straight onto session A's
// freshly created branch and fast-forward-pushed into A's open PR (#19,
// restored via force-with-lease — see DEBT-5). When the active scope records
// a branch and the checked-out branch differs, that is the collision
// signature: refuse, unless `--branch` explicitly names the checked-out
// branch (an override the caller logs). No scope or no recorded branch means
// no corroboration either way — allowed, so pair-mode and manual flows keep
// working. Pure + exported so it's testable without git or a repo.
export function checkShipBranch(opts: {
  current: string;
  scopeBranch: string;
  branchFlag: string | undefined;
}): { ok: true; overridden: boolean } | { ok: false; reason: string } {
  const { current, scopeBranch, branchFlag } = opts;
  if (!scopeBranch || scopeBranch === current) return { ok: true, overridden: false };
  if (branchFlag === current) return { ok: true, overridden: true };
  return {
    ok: false,
    reason:
      `pr: the active scope was recorded for branch "${scopeBranch}" but the working tree ` +
      `is on "${current}" — committing here would push this task's changes onto another ` +
      `task's branch (and its open PR, if any). Switch to the default branch and re-run, ` +
      `or pass --branch "${current}" if this checked-out branch really is where this ` +
      `task should ship (the override is logged to edit-log.jsonl).`,
  };
}

// Picks the branch name when `pnpm pr` runs from the default branch.
// Priority: explicit --branch flag, then `.task/branch` — but ONLY when it is
// fresh — then a slug of the PR title. `.task/branch` is ephemeral state from
// `pnpm scope`; it lingers after a task ships, so a bare "file exists" check
// silently reused dead tasks' branch names (observed: a docs PR landing on a
// merged task's `feature/claude-md`). Fresh means BOTH:
//   1. it matches the `branch` field in `.task/allowed-files.json` — the same
//      scope run wrote both, so an orphaned/hand-made file never qualifies;
//   2. no local or remote branch of that name already exists — an existing
//      branch means that scope already shipped a PR, i.e. the state is stale.
// Pure + exported so the selection logic is testable without git or a repo.
export function chooseBranch(opts: {
  branchFlag: string | undefined;
  title: string;
  taskBranch: string;
  scopeBranch: string;
  branchExists: boolean;
}): string {
  const { branchFlag, title, taskBranch, scopeBranch, branchExists } = opts;
  if (branchFlag) return branchFlag;
  if (taskBranch && taskBranch === scopeBranch && !branchExists) return taskBranch;
  return (
    'feat/' +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  );
}

// Does <branch> already exist, locally or on origin? Local heads and fetched
// remote-tracking refs are probed first (cheap, offline); when both miss,
// `git ls-remote` asks origin directly — a stale remote branch that was never
// fetched slips the local probes, and a later `git push -u` onto it could
// silently fast-forward someone's open PR (DEBT-4a). ls-remote failing
// (offline, no remote) degrades to the local answer instead of blocking.
function branchExistsInGit(branch: string): boolean {
  const local = ['refs/heads/', 'refs/remotes/origin/'].some(
    (p) => spawnSync('git', ['rev-parse', '--verify', '--quiet', p + branch]).status === 0,
  );
  if (local) return true;
  const remote = spawnSync('git', ['ls-remote', '--heads', 'origin', branch], {
    encoding: 'utf8',
  });
  return remote.status === 0 && remote.stdout.trim() !== '';
}

// Filters a changed-file list down to framework-owned paths (per
// FRAMEWORK_PATH_RE, the same pattern ci.yml's framework job greps with).
// Pure + exported so the matching is testable without git.
export function frameworkFiles(changedFiles: string[]): string[] {
  return changedFiles.filter((f) => FRAMEWORK_PATH_RE.test(f));
}

// Keeps the summary tail of a `pnpm test:framework` run for the PR body:
// everything from the " Test Files " summary line onward, or the last 10
// lines when that marker is absent (e.g. a crash before the summary).
// vitest colorizes this output even when piped, so ANSI SGR sequences are
// stripped first — they render as raw `[2m`/`[22m` noise in a PR body.
// Pure + exported so it's testable without spawning vitest.
export function frameworkTail(output: string): string {
  const lines = output
    // eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trimEnd()
    .split('\n');
  const start = lines.findIndex((l) => l.includes(' Test Files '));
  return (start >= 0 ? lines.slice(start) : lines.slice(-10)).join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const title = argv.find((a) => !a.startsWith('--'));
  if (!title) {
    console.error('Usage: pr "<title>" [--branch <name>] [--body-file <path>] [--no-verify]');
    process.exit(2);
  }
  // indexOf returns -1 when the flag is absent; [-1 + 1] would alias argv[0]
  // (the title), so gate on the flag actually being present.
  const flagValue = (flag: string): string | undefined =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  const branchFlag = flagValue('--branch');
  const bodyFileFlag = flagValue('--body-file');
  const skipVerify = argv.includes('--no-verify');

  // Set inside the gate below when the diff touches framework paths;
  // appended to the PR body after the Debt section.
  let frameworkSection: string | null = null;

  if (!skipVerify) {
    console.log('Running verify before PR…');
    const v = spawnSync('node', ['scripts/verify.ts'], { stdio: 'inherit' });
    if (v.status !== 0) {
      console.error('verify failed — not opening a PR.');
      process.exit(1);
    }

    // Framework gate: verify does NOT cover test/** (docs/FRAMEWORK.md §2), so a
    // diff touching framework paths must also pass `pnpm test:framework` —
    // run serially, after verify (the self-tests plant probes that race a
    // concurrent verify). Changed files = tracked diff vs origin/main plus
    // untracked; a missing origin/main skips gracefully (non-fatal, same
    // posture as the debt diff below). --no-verify above stays the only —
    // logged — way to skip this gate.
    const tracked = spawnSync('git', ['diff', '--name-only', 'origin/main'], { encoding: 'utf8' });
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
      encoding: 'utf8',
    });
    if (tracked.status !== 0) {
      console.warn('Could not diff against origin/main — skipping the framework-test gate.');
    } else {
      const changed = (tracked.stdout + '\n' + (untracked.stdout ?? ''))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (frameworkFiles(changed).length > 0) {
        console.log('Framework paths changed — running pnpm test:framework…');
        const ft = spawnSync('pnpm', ['test:framework'], { encoding: 'utf8' });
        const output = (ft.stdout ?? '') + (ft.stderr ?? '');
        if (ft.status !== 0) {
          console.error(frameworkTail(output));
          console.error('pnpm test:framework failed — not opening a PR.');
          process.exit(1);
        }
        frameworkSection = frameworkTail(output);
        console.log(frameworkSection);
      }
    }
  } else {
    appendRun({ kind: 'pr-no-verify', title });
    console.warn('verify skipped (--no-verify) — skip logged to edit-log.jsonl');
  }

  const defaultBranch =
    run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true).replace(
      'origin/',
      '',
    ) || 'main';
  const current = run('git', ['branch', '--show-current']);

  // Branch recorded by the active scope (`pnpm scope` writes it). Empty when
  // there is no scope, no branch field, or the file is unreadable — callers
  // treat empty as "no corroboration".
  let scopeBranch = '';
  if (existsSync('.task/allowed-files.json')) {
    try {
      const scope: unknown = JSON.parse(readFileSync('.task/allowed-files.json', 'utf8'));
      const b = (scope as Record<string, unknown>).branch;
      if (typeof b === 'string') scopeBranch = b;
    } catch {
      // Unreadable scope file = no corroboration; scopeBranch stays empty.
    }
  }

  let branch = current;
  if (current === defaultBranch || current === '') {
    const branchFile = '.task/branch';
    const taskBranch = existsSync(branchFile) ? readFileSync(branchFile, 'utf8').trim() : '';
    // Freshness cross-check (see chooseBranch). The git probes are allowed to
    // fail — a missing ref just means the branch doesn't exist.
    const branchExists = taskBranch !== '' && branchExistsInGit(taskBranch);
    branch = chooseBranch({ branchFlag, title, taskBranch, scopeBranch, branchExists });
    run('git', ['switch', '-c', branch]);
    console.log(`Created branch ${branch}`);
  } else {
    const check = checkShipBranch({ current, scopeBranch, branchFlag });
    if (!check.ok) {
      console.error(check.reason);
      process.exit(1);
    }
    if (check.overridden) {
      appendRun({ kind: 'pr-branch-override', title, branch: current, scopeBranch });
      console.warn(`Shipping on checked-out branch ${current} (--branch override; logged).`);
    }
  }

  // Consume-once: `.task/branch` has done its job on EVERY path through the
  // block above — the fresh path used it, the flag/slug/ship-in-place paths
  // superseded it — and deleting it here stops the NEXT task (back on the
  // default branch) from silently reusing it. It used to be consumed only on
  // the used-it path, leaving stale state behind on the others (DEBT-4b).
  rmSync('.task/branch', { force: true });

  run('git', ['add', '-A']);
  const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
  if (hasStaged) run('git', ['commit', '-m', title]);
  else console.log('Nothing to commit.');

  run('git', ['push', '-u', 'origin', branch]);

  const defaultBody = `Automated PR from \`scripts/pr.ts\`.\n\n_Verify ran green before push._`;
  const bodyFilePath = bodyFileFlag ?? (existsSync('.task/pr-body.md') ? '.task/pr-body.md' : null);
  let body = bodyFilePath ? readFileSync(bodyFilePath, 'utf8') : defaultBody;

  // Tech-debt visibility: surface DEBT.md changes in the PR body so reviewers
  // see logged debt without opening the diff. Non-fatal — a missing remote or
  // failed git call must not block the PR.
  const debtDiff = spawnSync('git', ['diff', 'origin/main', '--', 'DEBT.md'], {
    encoding: 'utf8',
  });
  // A failed diff is not the same as an empty diff — never assert "no debt
  // changes" when the diff could not be computed (e.g. origin/main missing).
  const debtSummary =
    debtDiff.status !== 0
      ? 'Debt diff unavailable (could not diff against origin/main).'
      : debtDiff.stdout.trim()
        ? '```diff\n' + debtDiff.stdout.trim() + '\n```'
        : 'No debt changes.';
  body += `\n\n## Debt\n\n${debtSummary}\n`;

  // Framework-test receipt: when the diff touched framework paths, the gate
  // above re-ran `pnpm test:framework`; surface its green summary tail so
  // reviewers see it without asking (docs/FRAMEWORK.md §2's standing rule).
  if (frameworkSection !== null) {
    body += `\n## Framework self-tests\n\n\`\`\`\n${frameworkSection}\n\`\`\`\n`;
  }

  const prUrl = run('gh', [
    'pr',
    'create',
    '--draft',
    '--title',
    title,
    '--body',
    body,
    '--head',
    branch,
  ]);
  console.log(`Opened PR: ${prUrl}`);

  const previewLink = `${prUrl}/checks`;
  run('gh', ['pr', 'comment', branch, '--body', `Preview / checks: ${previewLink}`], true);

  console.log('Polling for a Vercel preview URL…');
  const previewUrl = pollForPreviewUrl(branch);
  if (previewUrl) {
    console.log(`Preview: ${previewUrl}`);
    run('gh', ['pr', 'comment', branch, '--body', `Preview: ${previewUrl}`], true);
  } else {
    console.log('No Vercel preview URL found after polling window — continuing.');
  }

  appendRun({ kind: 'pr', title, branch, prUrl, previewUrl: previewUrl ?? null });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
