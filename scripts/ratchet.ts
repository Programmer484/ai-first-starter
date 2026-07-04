#!/usr/bin/env node
// Coverage-floor ratchet (CLAUDE.md rule 7): the coverage floors in
// vitest.config.ts may only go up. Compares the working tree against a
// baseline (origin/main by default) and fails if any floor was lowered
// or dropped.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONFIG = 'vitest.config.ts';
const KEYS = ['lines', 'functions', 'branches', 'statements'] as const;

// Tolerant extraction: find the `thresholds` block, take the first
// `<key>: <number>` after it. Survives formatting/structure drift.
function extractFloors(content: string): Partial<Record<(typeof KEYS)[number], number>> | null {
  const idx = content.indexOf('thresholds');
  if (idx === -1) return null;
  const tail = content.slice(idx);
  const floors: Partial<Record<(typeof KEYS)[number], number>> = {};
  for (const key of KEYS) {
    const m = tail.match(new RegExp(`${key}:\\s*(\\d+)`));
    if (m) floors[key] = Number(m[1]);
  }
  return floors;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const current = extractFloors(readFileSync(CONFIG, 'utf8'));
if (current === null || current.lines === undefined) {
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
  if (process.env.RATCHET_REQUIRE) {
    fail(
      `ratchet: RATCHET_REQUIRE is set but no baseline ref resolves; ` +
        `fetch the baseline first (git fetch origin main --depth=1) — the ratchet must not skip in CI`,
    );
  }
  console.log('ratchet: no baseline ref, skipping');
  process.exit(0);
}

const baseline = extractFloors(baseContent);
if (baseline === null || baseline.lines === undefined) {
  fail(
    `ratchet: baseline copy of ${CONFIG} has no \`thresholds.lines\` value; ` +
      `the coverage floor must exist in ${CONFIG} — a missing floor is a broken gate`,
  );
}

for (const key of KEYS) {
  const base = baseline[key];
  if (base === undefined) continue; // absent from baseline: nothing to guard
  const cur = current[key];
  if (cur === undefined) {
    fail(
      `ratchet: coverage floor \`${key}\` (baseline ${base}) was removed from ${CONFIG}; ` +
        `restore it at >= ${base} (CLAUDE.md rule 7 — the floor only ratchets upward)`,
    );
  }
  if (cur < base) {
    fail(
      `ratchet: coverage floor \`${key}\` lowered ${base} -> ${cur} in ${CONFIG}; ` +
        `raise it back to at least ${base} (CLAUDE.md rule 7 — the floor only ratchets upward)`,
    );
  }
}
console.log(`ratchet: OK (floors ${KEYS.map((k) => `${k} ${current[k] ?? '-'}`).join(', ')})`);
