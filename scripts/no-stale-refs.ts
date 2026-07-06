#!/usr/bin/env node
// Check (verify step "no-stale-refs"): src/** must not contain the string
// `.task/` — that directory is gitignored and exists only for the lifetime
// of a task, so a reference to it (a comment, a path in a string) rots the
// moment the task ends and misleads whoever reads it next.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const NEEDLE = '.task/';

function walk(dir: string): string[] {
  let hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits = hits.concat(walk(full));
    } else if (entry.isFile() && readFileSync(full, 'utf8').includes(NEEDLE)) {
      hits.push(relative(ROOT, full));
    }
  }
  return hits;
}

const hits = walk(SRC);

if (hits.length > 0) {
  console.error('no-stale-refs: found stale `.task/` references under src/**:\n');
  for (const f of hits) {
    console.error(
      `  ✖ ${f} contains ".task/"\n` +
        `  Fix: remove the reference — .task/ is gitignored, per-task scratch state; a comment pointing at it rots once the task ends.\n`,
    );
  }
  process.exit(1);
}
console.log('no-stale-refs: OK');
