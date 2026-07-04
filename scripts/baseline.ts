#!/usr/bin/env node
// Baseline discrimination for verify failures: does each failing step ALSO
// fail on a clean checkout of HEAD? Runs the steps in a throwaway git
// worktree and classifies each as pre-existing (fails at HEAD too) or
// introduced (passes at HEAD, so the working-tree changes broke it).
// Never touches the user's working tree or index.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appendRun } from './edit-log.ts';

export function classifyLine(step: string, passesAtHead: boolean): string {
  return passesAtHead
    ? `baseline: ${step} — introduced by working-tree changes (passes at HEAD)`
    : `baseline: ${step} — pre-existing (also fails at HEAD)`;
}

// When invoked from a git hook (pre-commit), GIT_DIR/GIT_INDEX_FILE point at
// the outer repo and would corrupt every git call and step run inside the
// temp worktree — strip them.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
);

function git(args: string[], cwd?: string) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv });
}

function main(): void {
  const steps = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (steps.length === 0) {
    console.error('baseline: no steps given. Usage: node scripts/baseline.ts <step> [step...]');
    process.exit(2);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'verify-baseline-'));
  try {
    const add = git(['worktree', 'add', tmp, 'HEAD']);
    if (add.status !== 0) {
      throw new Error(`git worktree add failed:\n${add.stderr}`);
    }

    // Cheap node_modules: symlink ours when the lockfile matches HEAD,
    // otherwise do a real install in the temp worktree.
    const lockUnchanged = git(['diff', '--quiet', 'HEAD', '--', 'pnpm-lock.yaml']).status === 0;
    if (lockUnchanged) {
      symlinkSync(resolve('node_modules'), join(tmp, 'node_modules'), 'dir');
    } else {
      const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
        cwd: tmp,
        encoding: 'utf8',
        env: cleanEnv,
      });
      if (install.status !== 0) {
        throw new Error(`pnpm install in baseline worktree failed:\n${install.stderr}`);
      }
    }

    const preExisting: string[] = [];
    const introduced: string[] = [];
    for (const step of steps) {
      const res = spawnSync('node', ['scripts/verify.ts', step], {
        cwd: tmp,
        stdio: 'ignore',
        // the symlinked node_modules belongs to another dir; without this,
        // pnpm's deps-status check tries to reinstall and every step "fails"
        env: { ...cleanEnv, pnpm_config_verify_deps_before_run: 'false' },
      });
      const passesAtHead = res.status === 0;
      (passesAtHead ? introduced : preExisting).push(step);
      console.log(classifyLine(step, passesAtHead));
    }

    appendRun({ kind: 'baseline', steps, preExisting, introduced });
  } catch (err) {
    console.error(`baseline machinery failed: ${err instanceof Error ? err.message : err}`);
    console.error(
      'Check `git worktree list` for stale entries (clean with `git worktree prune`) ' +
        'and that `pnpm install --frozen-lockfile --prefer-offline` works.',
    );
    process.exitCode = 2;
  } finally {
    try {
      const removed = git(['worktree', 'remove', '--force', tmp]);
      if (removed.status !== 0) {
        rmSync(tmp, { recursive: true, force: true });
        git(['worktree', 'prune']);
      }
    } catch {
      // cleanup is best-effort; a stale temp dir must not mask the result
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
