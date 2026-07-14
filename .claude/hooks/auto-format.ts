#!/usr/bin/env node
// PostToolUse hook. After a file is written/edited, run Prettier on just that
// file so the tree never drifts out of format between verify runs.
// Non-blocking: formatting problems never fail the agent's edit.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, isAbsolute, resolve, sep } from 'node:path';

// Must stay a superset match of PRETTIER_EXT in scripts/verify.ts.
const FORMATTABLE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.jsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '.html',
]);

type HookInput = { tool_input?: { file_path?: string }; cwd?: string };

function main(): void {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return;
  }
  if (!raw.trim()) return;

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const file = input.tool_input?.file_path;
  if (!file || !FORMATTABLE.has(extname(file))) return;

  // Format only files inside this repo. Agents may write files in other
  // repos (which own their own style) or scratch dirs; imposing this repo's
  // Prettier config there causes cross-repo formatting churn.
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const abs = isAbsolute(file) ? file : resolve(input.cwd ?? process.cwd(), file);
  if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) return;

  spawnSync('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', file], {
    cwd: input.cwd ?? process.cwd(),
    stdio: 'ignore',
  });
}

main();
