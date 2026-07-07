#!/usr/bin/env node
// Two ratchet checks, each compared against a baseline ref (origin/main by
// default):
// 1. Coverage-floor ratchet (CLAUDE.md rule 7): COVERAGE_FLOOR in
//    scripts/gates.ts may only go up.
// 2. Gate-profile ratchet: no module's `gates` may weaken (full -> polish,
//    full -> shell, polish -> shell) versus the baseline. New modules may
//    start at any profile; strengthening a profile is always fine.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readModuleMap } from './module-map.ts';

const GATES_FILE = 'scripts/gates.ts';
const MAP_FILE = 'module-map.json';
const KEYS = ['lines', 'functions', 'branches', 'statements'] as const;

// Tolerant extraction: find the `COVERAGE_FLOOR` block, take the first
// `<key>: <number>` after it. Survives formatting/structure drift.
function extractFloors(content: string): Partial<Record<(typeof KEYS)[number], number>> | null {
  const idx = content.indexOf('COVERAGE_FLOOR');
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

// Resolve a file's content at the baseline: an explicit override wins (tests
// use this to avoid touching git); otherwise walk RATCHET_BASE (or the
// origin/main -> main default pair), returning the content at the first ref
// where the file exists. Returns null if nothing resolves.
function baselineContent(path: string, override: string | undefined): string | null {
  if (override !== undefined) return override;
  const refs = process.env.RATCHET_BASE ? [process.env.RATCHET_BASE] : ['origin/main', 'main'];
  for (const ref of refs) {
    const res = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
    if (res.status === 0) return res.stdout;
  }
  return null;
}

// No baseline resolves for `path`: fail closed under RATCHET_REQUIRE (CI must
// not skip-pass silently); otherwise log and let the caller skip that check.
// Keep the "no baseline ref, skipping" phrase contiguous — existing callers
// match on that exact substring.
function noBaseline(path: string): void {
  if (process.env.RATCHET_REQUIRE) {
    fail(
      `ratchet: RATCHET_REQUIRE is set but no baseline ref resolves; ` +
        `fetch the baseline first (git fetch origin main --depth=1) — the ratchet must not skip in CI`,
    );
  }
  console.log(`ratchet: no baseline ref, skipping (${path})`);
}

// --- 1. Coverage floor (CLAUDE.md rule 7) -----------------------------------

const current = extractFloors(readFileSync(GATES_FILE, 'utf8'));
if (current === null || current.lines === undefined) {
  fail(
    `ratchet: could not find \`COVERAGE_FLOOR\` in ${GATES_FILE}; ` +
      `add \`export const COVERAGE_FLOOR = { lines: <number>, ... }\` — a missing floor is a broken gate`,
  );
}

const baseGatesContent = baselineContent(GATES_FILE, process.env.RATCHET_BASE_CONTENT);
const baselineFloors = baseGatesContent === null ? null : extractFloors(baseGatesContent);
if (baseGatesContent === null) {
  noBaseline(GATES_FILE);
} else if (baselineFloors === null) {
  // The baseline predates the COVERAGE_FLOOR anchor (e.g. gates.ts from
  // before the floor moved here out of vitest.config.ts). Absent from
  // baseline = nothing to guard — same posture as a per-key missing floor
  // below. The CURRENT file must still carry the anchor (hard-checked above).
  console.log(
    `ratchet: baseline ${GATES_FILE} has no COVERAGE_FLOOR anchor — nothing to guard, ` +
      `skipping the coverage-floor comparison`,
  );
} else {
  const baseline = baselineFloors;
  for (const key of KEYS) {
    const base = baseline[key];
    if (base === undefined) continue; // absent from baseline: nothing to guard
    const cur = current[key];
    if (cur === undefined) {
      fail(
        `ratchet: coverage floor \`${key}\` (baseline ${base}) was removed from ${GATES_FILE}; ` +
          `restore it at >= ${base} (CLAUDE.md rule 7 — the floor only ratchets upward)`,
      );
    }
    if (cur < base) {
      fail(
        `ratchet: coverage floor \`${key}\` lowered ${base} -> ${cur} in ${GATES_FILE}; ` +
          `raise it back to at least ${base} (CLAUDE.md rule 7 — the floor only ratchets upward)`,
      );
    }
  }
  console.log(
    `ratchet: coverage floor OK (${KEYS.map((k) => `${k} ${current[k] ?? '-'}`).join(', ')})`,
  );
}

// --- 2. Gate-profile weakening -----------------------------------------------

// Strictness order: full is strongest, shell is weakest. A module may only
// move to an equal-or-higher rank versus the baseline.
const GATE_RANK = { full: 2, polish: 1, shell: 0 } as const;
const rankOf = (gate: string | undefined): number =>
  gate && gate in GATE_RANK ? GATE_RANK[gate as keyof typeof GATE_RANK] : GATE_RANK.full;

function gatesByName(modules: Array<{ name: string; gates?: string }>): Map<string, string> {
  const gates = new Map<string, string>();
  for (const m of modules) gates.set(m.name, m.gates ?? 'full');
  return gates;
}

const baseMapContent = baselineContent(MAP_FILE, process.env.RATCHET_MODULE_MAP_BASE_CONTENT);
if (baseMapContent === null) {
  noBaseline(MAP_FILE);
} else if (baselineFloors === null) {
  // The baseline predates the COVERAGE_FLOOR anchor — either its gates.ts
  // lacks the anchor, or it has no scripts/gates.ts at all (baselineFloors is
  // null in both cases). Either way it predates the per-module gate-profile
  // system: back then a `gates` value did not drive per-module thresholds, so
  // comparing gate ranks against it would flag the framework migration itself
  // as a regression. Same skip posture as the coverage-floor comparison
  // above; from the first post-migration baseline onward the comparison is
  // live again.
  console.log(
    `ratchet: baseline ${GATES_FILE} is missing or has no COVERAGE_FLOOR anchor — baseline ` +
      `predates gate profiles, skipping the gate-profile comparison`,
  );
} else {
  let baselineParsed: { modules?: Array<{ name: string; gates?: string }> };
  try {
    baselineParsed = JSON.parse(baseMapContent);
  } catch (err) {
    fail(
      `ratchet: baseline copy of ${MAP_FILE} is not valid JSON (${err instanceof Error ? err.message : err}); ` +
        `cannot check for gate-profile weakening`,
    );
  }
  // Current side goes through the shared reader (useEnv = true) so tests can
  // point it at a doctored map via MODULE_MAP, same seam module-sync.ts and
  // new-module.ts already use — no stray env var ever swaps this at runtime
  // because `pnpm verify` never sets MODULE_MAP.
  const baselineGates = gatesByName(baselineParsed.modules ?? []);
  const currentGates = gatesByName(readModuleMap(undefined, true).modules);

  for (const [name, baseGate] of baselineGates) {
    const curGate = currentGates.get(name);
    if (curGate === undefined) continue; // module removed: not this check's concern
    if (rankOf(curGate) < rankOf(baseGate)) {
      fail(
        `ratchet: module "${name}" gates weakened ${baseGate} -> ${curGate} in ${MAP_FILE}; ` +
          `gate profiles only strengthen (full -> polish/shell, or polish -> shell, is not allowed) — ` +
          `restore \`"gates": "${baseGate}"\` for "${name}", or discuss the regression before merging`,
      );
    }
  }
  console.log('ratchet: gate-profile OK (no module weakened)');
}
