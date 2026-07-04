#!/usr/bin/env node
// One command, one exit code. Runs the full quality gate:
// format check -> lint (incl. module boundaries) -> typecheck -> test+coverage -> dead code.
// Used locally (`pnpm verify`) and in CI so both report the same result.
import { spawnSync } from 'node:child_process';
import { appendRun } from './edit-log.ts';

type Step = { name: string; cmd: string; args: string[] };

const steps: Step[] = [
  { name: 'module-sync', cmd: 'node', args: ['scripts/module-sync.ts'] },
  { name: 'format', cmd: 'pnpm', args: ['exec', 'prettier', '--check', '.'] },
  { name: 'lint', cmd: 'pnpm', args: ['exec', 'eslint', '.'] },
  { name: 'typecheck', cmd: 'pnpm', args: ['exec', 'tsc', '--noEmit'] },
  { name: 'test', cmd: 'pnpm', args: ['exec', 'vitest', 'run', '--coverage'] },
  { name: 'knip', cmd: 'pnpm', args: ['exec', 'knip'] },
];

const only = process.argv[2];
const selected = only ? steps.filter((s) => s.name === only) : steps;
if (selected.length === 0) {
  console.error(`Unknown step "${only}". Known: ${steps.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

const failed: string[] = [];
const start = Date.now();

for (const step of selected) {
  console.log(`\n── ${step.name} ──`);
  const res = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false });
  if (res.status !== 0) failed.push(step.name);
}

const durationMs = Date.now() - start;
console.log(`\n${'─'.repeat(24)}`);
if (failed.length === 0) {
  console.log(`verify: PASS (${(durationMs / 1000).toFixed(1)}s)`);
} else {
  console.log(`verify: FAIL [${failed.join(', ')}] (${(durationMs / 1000).toFixed(1)}s)`);
}

appendRun({ kind: 'verify', steps: selected.map((s) => s.name), failed, durationMs });

process.exit(failed.length === 0 ? 0 : 1);
