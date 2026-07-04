#!/usr/bin/env node
// Coverage-floor ratchet (CLAUDE.md rule 7): the `thresholds.lines` floor in
// vitest.config.ts may only go up. Compares the working tree against a
// baseline (origin/main by default) and fails if the floor was lowered.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONFIG = 'vitest.config.ts';

// Tolerant extraction: find the `thresholds` block, take the first
// `lines: <number>` after it. Survives formatting/structure drift.
function extractFloor(content: string): number | null {
  const idx = content.indexOf('thresholds');
  if (idx === -1) return null;
  const m = content.slice(idx).match(/lines:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const current = extractFloor(readFileSync(CONFIG, 'utf8'));
if (current === null) {
  fail(
    `ratchet: could not find the coverage floor in ${CONFIG}; ` +
      `add \`thresholds: { lines: <number> }\` under coverage — a missing floor is a broken gate`,
  );
}

let baseContent: string | null = process.env.RATCHET_BASE_CONTENT ?? null;
if (baseContent === null) {
  const refs = process.env.RATCHET_BASE ? [process.env.RATCHET_BASE] : ['origin/main', 'main'];
  for (const ref of refs) {
    const res = spawnSync('git', ['show', `${ref}:${CONFIG}`], { encoding: 'utf8' });
    if (res.status === 0) {
      baseContent = res.stdout;
      break;
    }
  }
}
if (baseContent === null) {
  console.log('ratchet: no baseline ref, skipping');
  process.exit(0);
}

const baseline = extractFloor(baseContent);
if (baseline === null) {
  fail(
    `ratchet: baseline copy of ${CONFIG} has no \`thresholds.lines\` value; ` +
      `the coverage floor must exist in ${CONFIG} — a missing floor is a broken gate`,
  );
}

if (current < baseline) {
  fail(
    `ratchet: coverage floor lowered ${baseline} -> ${current} in ${CONFIG}; ` +
      `raise it back to at least ${baseline} (CLAUDE.md rule 7 — the floor only ratchets upward)`,
  );
}
console.log(`ratchet: OK (floor ${current} >= baseline ${baseline})`);
