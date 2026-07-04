#!/usr/bin/env node
// Ship a task: create a branch (if on the default branch), commit, push, open a
// draft PR with `gh`, and drop a preview-link comment. Runs verify first — a
// red tree never becomes a PR.
//
// Usage: pnpm pr "feat: add foo module" [--branch feat/foo] [--body-file path] [--no-verify]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appendRun } from './edit-log.ts';

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

  if (!skipVerify) {
    console.log('Running verify before PR…');
    const v = spawnSync('node', ['scripts/verify.ts'], { stdio: 'inherit' });
    if (v.status !== 0) {
      console.error('verify failed — not opening a PR.');
      process.exit(1);
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

  let branch = current;
  if (current === defaultBranch || current === '') {
    const branchFile = '.task/branch';
    const branchFromFile = existsSync(branchFile) ? readFileSync(branchFile, 'utf8').trim() : '';
    branch =
      branchFlag ??
      (branchFromFile ||
        'feat/' +
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40));
    run('git', ['switch', '-c', branch]);
    console.log(`Created branch ${branch}`);
  }

  run('git', ['add', '-A']);
  const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
  if (hasStaged) run('git', ['commit', '-m', title]);
  else console.log('Nothing to commit.');

  run('git', ['push', '-u', 'origin', branch]);

  const defaultBody = `Automated PR from \`scripts/pr.ts\`.\n\n_Verify ran green before push._`;
  const bodyFilePath = bodyFileFlag ?? (existsSync('.task/pr-body.md') ? '.task/pr-body.md' : null);
  const body = bodyFilePath ? readFileSync(bodyFilePath, 'utf8') : defaultBody;

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
