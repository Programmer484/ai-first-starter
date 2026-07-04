#!/usr/bin/env node
// One command, one exit code. Runs the full quality gate:
// format check -> lint (incl. module boundaries) -> typecheck -> test+coverage -> dead code.
// Used locally (`pnpm verify`) and in CI so both report the same result.
//
// `--agent` mode: captures step output and prints a bounded, file-grouped
// failure summary instead of the raw dump, and overwrites (never appends)
// a machine-readable snapshot at .task/last-verify.json so a repair loop
// always reads the latest state.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendRun } from './edit-log.ts';

type Step = { name: string; cmd: string; args: string[] };

const steps: Step[] = [
  { name: 'module-sync', cmd: 'node', args: ['scripts/module-sync.ts'] },
  { name: 'format', cmd: 'pnpm', args: ['exec', 'prettier', '--check', '.'] },
  { name: 'lint', cmd: 'pnpm', args: ['exec', 'eslint', '.'] },
  { name: 'typecheck', cmd: 'pnpm', args: ['exec', 'tsc', '--noEmit'] },
  { name: 'test', cmd: 'pnpm', args: ['exec', 'vitest', 'run', '--coverage'] },
  { name: 'ratchet', cmd: 'node', args: ['scripts/ratchet.ts'] },
  { name: 'knip', cmd: 'pnpm', args: ['exec', 'knip'] },
];

const argv = process.argv.slice(2);
const agent = argv.includes('--agent');
const baseline = argv.includes('--baseline');
const only = argv.find((a) => !a.startsWith('--'));
const selected = only ? steps.filter((s) => s.name === only) : steps;
if (selected.length === 0) {
  console.error(`Unknown step "${only}". Known: ${steps.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

const MAX_LINES_PER_FILE = 3;
const MAX_SUMMARY_LINES = 60;

// Something that looks like a file path: segments/with/slashes ending in .ext.
const PATH_RE = /\/?(?:[\w.@-]+\/)+[\w.@-]+\.[a-z]{1,6}\b/i;

type StepSummary = { files: Record<string, string[]>; totalErrors: number };

// Group output lines by the file path they mention. A line that IS a bare
// path (eslint-style header) opens a bucket that indented follow-up lines
// fall into; a blank line closes it. Pathless lines go to "(general)".
// Buckets are capped at MAX_LINES_PER_FILE, identical lines collapse to ×N.
function summarize(output: string): StepSummary {
  const counts: Record<string, Map<string, number>> = {};
  let current: string | null = null;
  let totalErrors = 0;
  // eslint-disable-next-line no-control-regex -- strip ANSI color codes
  for (const raw of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      current = null;
      continue;
    }
    const m = line.match(PATH_RE);
    let bucket = current ?? '(general)';
    if (m) {
      bucket = m[0];
      if (line.trim() === m[0]) current = m[0];
    }
    totalErrors++;
    const perFile = (counts[bucket] ??= new Map());
    perFile.set(line.trim(), (perFile.get(line.trim()) ?? 0) + 1);
  }
  const files: Record<string, string[]> = {};
  for (const [file, perFile] of Object.entries(counts)) {
    files[file] = [...perFile.entries()]
      .slice(0, MAX_LINES_PER_FILE)
      .map(([text, n]) => (n > 1 ? `${text} ×${n}` : text));
  }
  return { files, totalErrors };
}

function apiSurface(): Record<string, number> {
  const surface: Record<string, number> = {};
  try {
    const map = JSON.parse(readFileSync('module-map.json', 'utf8')) as {
      modules: { name: string; path: string }[];
    };
    for (const mod of map.modules) {
      try {
        const src = readFileSync(`${mod.path}/index.ts`, 'utf8');
        // ponytail: crude regex count — a bloat trend signal, not a gate.
        surface[mod.name] = (src.match(/^\s*export\b/gm) ?? []).length;
      } catch {
        surface[mod.name] = 0;
      }
    }
  } catch {
    // unreadable map: leave the surface empty rather than fail the gate
  }
  return surface;
}

const failed: string[] = [];
const summaryByStep: Record<string, StepSummary> = {};
const start = Date.now();
let budget = MAX_SUMMARY_LINES;

for (const step of selected) {
  console.log(`\n── ${step.name} ──`);
  let ok: boolean;
  let output = '';
  if (agent) {
    const res = spawnSync(step.cmd, step.args, { encoding: 'utf8', shell: false });
    ok = res.status === 0;
    output = (res.stdout ?? '') + (res.stderr ?? '');
  } else {
    ok = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false }).status === 0;
  }
  if (!ok) failed.push(step.name);
  if (!agent) continue;

  if (ok) {
    console.log('OK');
    continue;
  }
  const summary = summarize(output);
  summaryByStep[step.name] = summary;
  const fileCount = Object.keys(summary.files).length;
  const tail = `${step.name}: ${summary.totalErrors} error lines across ${fileCount} files (showing ${MAX_LINES_PER_FILE}/file)`;
  if (budget <= 0) {
    console.log(tail);
    continue;
  }
  for (const [file, lines] of Object.entries(summary.files)) {
    if (budget <= 0) break;
    console.log(`  ${file}`);
    budget--;
    for (const line of lines) {
      if (budget <= 0) break;
      console.log(`    ${line}`);
      budget--;
    }
  }
  console.log(tail);
}

const durationMs = Date.now() - start;
console.log(`\n${'─'.repeat(24)}`);
if (failed.length === 0) {
  console.log(`verify: PASS (${(durationMs / 1000).toFixed(1)}s)`);
} else {
  console.log(`verify: FAIL [${failed.join(', ')}] (${(durationMs / 1000).toFixed(1)}s)`);
  if (baseline) {
    spawnSync('node', ['scripts/baseline.ts', ...failed], { stdio: 'inherit', shell: false });
  } else {
    console.log(`not sure it's your change? pnpm verify --baseline`);
  }
}

if (agent) {
  // Overwrite, never append: a repair loop must read the latest state only.
  mkdirSync('.task', { recursive: true });
  writeFileSync(
    '.task/last-verify.json',
    JSON.stringify({ ts: new Date().toISOString(), failed, summaryByStep }, null, 2) + '\n',
  );
}

appendRun({
  kind: 'verify',
  steps: selected.map((s) => s.name),
  failed,
  durationMs,
  apiSurface: apiSurface(),
});

process.exit(failed.length === 0 ? 0 : 1);
