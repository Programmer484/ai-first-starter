#!/usr/bin/env node
// Instantiate this template for a new project: rename it, pick a stack preset,
// and reset the per-project state (edit log). Run once, right after cloning.
//
// Usage: pnpm init:project <project-name> [--preset node|web]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const [rawName, ...rest] = process.argv.slice(2);
if (!rawName) {
  console.error('Usage: init:project <project-name> [--preset node|web]');
  process.exit(2);
}
const name = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-');

const presets: Record<string, string> = {
  node: 'A TypeScript Node project scaffolded from ai-first-starter.',
  web: 'A TypeScript web project scaffolded from ai-first-starter (add Vite entry under src/).',
};
const presetKey = (rest[rest.indexOf('--preset') + 1] as string) || 'node';
const preset = presets[presetKey];
if (!preset) {
  console.error(`Unknown preset "${presetKey}". Known: ${Object.keys(presets).join(', ')}`);
  process.exit(2);
}

// package.json: set the name.
const pkgPath = ROOT + 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = name;
pkg.version = '0.1.0';
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// README: fresh, project-specific.
writeFileSync(
  ROOT + 'README.md',
  `# ${name}

${preset}

## Getting started

\`\`\`bash
pnpm install
pnpm verify        # lint + typecheck + test + boundaries + coverage
pnpm new-module x  # scaffold a registered module
\`\`\`

Architecture lives in \`module-map.json\` — the single source of truth for
module boundaries. See \`CLAUDE.md\` for the rules agents follow here.
`,
);

// Reset per-project run state.
const log = ROOT + 'edit-log.jsonl';
if (existsSync(log)) rmSync(log);

// Optional, non-fatal: enable GitHub branch protection (require PRs) on the
// default branch. Server-side backstop for the local pre-push guard
// (scripts/pre-push-guard.ts): the hook checks the branch you are ON, so a
// refspec push like `git push origin HEAD:main` needs host protection to be
// rejected. Skips with a log line when gh is missing/unauthenticated or the
// origin remote is not GitHub — never fails init.
function tryEnableBranchProtection(): void {
  const sh = (cmd: string, args: string[], input?: string) =>
    spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', input });

  const remote = sh('git', ['remote', 'get-url', 'origin']);
  const url = remote.status === 0 ? remote.stdout.trim() : '';
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) {
    console.log('Branch protection: skipped (no GitHub origin remote).');
    return;
  }
  if (sh('gh', ['--version']).status !== 0) {
    console.log('Branch protection: skipped (gh CLI not installed).');
    return;
  }
  if (sh('gh', ['auth', 'status']).status !== 0) {
    console.log('Branch protection: skipped (gh not authenticated — run `gh auth login`).');
    return;
  }
  const head = sh('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const branch = head.status === 0 ? head.stdout.trim().replace(/^origin\//, '') || 'main' : 'main';
  const protection = JSON.stringify({
    required_pull_request_reviews: { required_approving_review_count: 0 },
    required_status_checks: null,
    enforce_admins: false,
    restrictions: null,
  });
  const res = sh(
    'gh',
    [
      'api',
      '--method',
      'PUT',
      `repos/${m[1]}/${m[2]}/branches/${branch}/protection`,
      '--input',
      '-',
    ],
    protection,
  );
  if (res.status === 0) {
    console.log(`Branch protection: enabled on '${branch}' (PRs required).`);
  } else {
    const first = (res.stderr ?? '').trim().split('\n')[0] ?? '';
    console.log(`Branch protection: could not enable on '${branch}' (non-fatal). ${first}`);
  }
}
tryEnableBranchProtection();

console.log(`Initialised "${name}" (preset: ${presetKey}).`);
console.log('Next: pnpm install && pnpm verify');
