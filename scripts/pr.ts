#!/usr/bin/env node
// Ship a task: create a branch (if on the default branch), commit, push, open a
// draft PR with `gh`, and drop a preview-link comment. Runs verify first — a
// red tree never becomes a PR.
//
// Usage: pnpm pr "feat: add foo module" [--branch feat/foo] [--no-verify]
import { spawnSync } from 'node:child_process';
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

const argv = process.argv.slice(2);
const title = argv.find((a) => !a.startsWith('--'));
if (!title) {
  console.error('Usage: pr "<title>" [--branch <name>] [--no-verify]');
  process.exit(2);
}
const branchFlag = argv[argv.indexOf('--branch') + 1];
const skipVerify = argv.includes('--no-verify');

if (!skipVerify) {
  console.log('Running verify before PR…');
  const v = spawnSync('node', ['scripts/verify.ts'], { stdio: 'inherit' });
  if (v.status !== 0) {
    console.error('verify failed — not opening a PR.');
    process.exit(1);
  }
}

const defaultBranch =
  run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true).replace(
    'origin/',
    '',
  ) || 'main';
const current = run('git', ['branch', '--show-current']);

let branch = current;
if (current === defaultBranch || current === '') {
  branch =
    branchFlag ??
    'feat/' +
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
  run('git', ['switch', '-c', branch]);
  console.log(`Created branch ${branch}`);
}

run('git', ['add', '-A']);
const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
if (hasStaged) run('git', ['commit', '-m', title]);
else console.log('Nothing to commit.');

run('git', ['push', '-u', 'origin', branch]);

const prUrl = run('gh', [
  'pr',
  'create',
  '--draft',
  '--title',
  title,
  '--body',
  `Automated PR from \`scripts/pr.ts\`.\n\n_Verify ran green before push._`,
  '--head',
  branch,
]);
console.log(`Opened PR: ${prUrl}`);

const previewLink = `${prUrl}/checks`;
run('gh', ['pr', 'comment', branch, '--body', `Preview / checks: ${previewLink}`], true);

appendRun({ kind: 'pr', title, branch, prUrl });
