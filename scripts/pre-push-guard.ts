#!/usr/bin/env node
// Lefthook pre-push guard: refuse a push made from the default branch — ship
// through `pnpm pr` (branch + commit + draft PR) instead. The default branch
// is read from origin/HEAD (`git symbolic-ref refs/remotes/origin/HEAD`),
// falling back to 'main' when the symbolic ref is unset (fresh clones that
// never ran `git remote set-head`).
//
// Escape hatch: ALLOW_MAIN_PUSH=1 lets the push through, but the override is
// appended to edit-log.jsonl — same ledger as `pnpm pr --no-verify` skips.
//
// Known escape: `git push origin HEAD:main` from a feature branch is not
// caught here (we check the branch you are ON, not the pushed refspec).
// Host-side branch protection — enabled by scripts/init.ts via `gh` —
// rejects that server-side.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendRun } from './edit-log.ts';

function git(args: string[]): string {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

function main(): void {
  const defaultBranch =
    git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).replace(
      /^origin\//,
      '',
    ) || 'main';
  const current = git(['branch', '--show-current']);
  if (current !== defaultBranch) return; // feature branch (or detached HEAD) — push away

  if (process.env.ALLOW_MAIN_PUSH === '1') {
    appendRun({ kind: 'main-push-override', branch: current });
    console.warn(
      `ALLOW_MAIN_PUSH=1 — pushing '${current}' directly; override logged to edit-log.jsonl.`,
    );
    return;
  }

  console.error(
    `Refusing to push the default branch ('${current}') directly.\n` +
      `Ship through a PR instead: pnpm pr "<title>" — it branches, commits, pushes,\n` +
      `and opens a draft PR for you.\n` +
      `Emergency override: ALLOW_MAIN_PUSH=1 git push … (logged to edit-log.jsonl).`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
